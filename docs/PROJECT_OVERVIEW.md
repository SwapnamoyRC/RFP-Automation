# RFP Automation System

**AI-Powered Furniture Product Matching for RFP Responses**

---

## Problem Statement

In the commercial furniture industry, companies regularly receive **RFP (Request for Proposal)** documents — Excel spreadsheets listing dozens of furniture requirements (desks, chairs, sofas, lighting, etc.) along with quantities, locations, and sometimes reference images.

Responding to these RFPs is a **manual, time-consuming process**:

- A specialist must read each line item, interpret the requirement, and search through multiple brand catalogs to find the best-matching product.
- RFPs often contain **embedded reference images** that are critical for identification but impossible to search against in traditional databases.
- Product descriptions in RFPs are frequently vague, inconsistent, or use non-standard naming (e.g., *"round mushroom-shaped side table"* instead of the actual product name).
- The final response must be compiled into a **professional PowerPoint presentation** — another tedious step.

For a 30-item RFP across three furniture brands, this process can take **hours of manual effort** per response.

---

## Solution

This system **automates the entire RFP response pipeline** — from parsing the Excel document to generating a client-ready PowerPoint — using AI-powered semantic search and computer vision.

---

## Architecture Overview

```
                         ┌──────────────────────┐
                         │    Telegram Bot       │
                         │    (n8n workflow)      │
                         └──────────┬───────────┘
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │  Node.js REST API     │
                         │  (Express.js)         │
                         └──────────┬───────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
     ┌────────────────┐   ┌────────────────┐   ┌────────────────┐
     │  RFP Parser    │   │  Search Engine │   │  PPT Generator │
     │  (Excel → Items)│   │  (pgvector)   │   │  (PptxGenJS)   │
     └────────────────┘   └────────┬───────┘   └────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
             ┌───────────┐ ┌───────────┐ ┌───────────────┐
             │ Text      │ │ Image     │ │ Vision-to-    │
             │ Embeddings│ │ Embeddings│ │ Vision Match  │
             └───────────┘ └───────────┘ └───────────────┘
                                   │
                                   ▼
                         ┌──────────────────────┐
                         │  PostgreSQL + pgvector│
                         │  (Vector Database)    │
                         └──────────────────────┘
```

---

## How It Works

### 1. Data Ingestion — Building the Product Knowledge Base

The system scrapes product catalogs from three furniture brands using **Playwright** browser automation:

| Brand | Focus |
|-------|-------|
| **HAY** | Office & home furniture, lighting, accessories |
| **Muuto** | Scandinavian design — tables, seating, lighting |
| **NaughtOne** | Contemporary office furniture, modular seating |

For each product, the system collects:
- Product name, description, dimensions, materials, certifications
- All product images (8,000+ for NaughtOne alone)
- PDF spec sheets and brochures
- Technical specifications (dimensions, weight, sustainability data)

Scraping runs on a **weekly cron schedule** (Sundays at 2 AM) to keep the catalog fresh.

### 2. Embedding Generation — Making Products Searchable

Every product is converted into **vector embeddings** (numerical representations that capture semantic meaning) using OpenAI's `text-embedding-3-small` model (1,536 dimensions).

**Text Embeddings** are generated from structured product data:
```
Brand: NaughtOne
Product Family: Hush
Variants: Hush Chair, Hush Low Chair, Hush Sofa
Dimensions: W720 x D680 x H1050mm (Seat H 430mm)
Materials: Solid Oak, Solid Walnut, Powder Coated Steel
Certifications: BIFMA, Greenguard
```

**Image Embeddings** follow a two-step process:
1. **Vision AI** (Claude Sonnet) analyzes up to 3 representative product photos and generates a detailed text description of the furniture — its type, shape, base style, materials, and colors.
2. That description text is then embedded into the same vector space as the text embeddings.

**Smart image selection** ensures only clean product shots are used — front views and three-quarter angles are prioritized, while group photos and lifestyle/client images are excluded.

This creates a **unified search space** where both text descriptions and visual descriptions can be compared against incoming RFP queries.

### 3. RFP Processing — Parsing the Request

When an RFP Excel file is uploaded, the parser:

1. **Auto-detects the format** — three common Excel layouts are supported:

   | Format | Structure |
   |--------|-----------|
   | **A** | S.No, Description (with sub-rows for dimensions/materials), Qty, Rate |
   | **B** | S.No, Requirement, Location, Qty, Recommended Product |
   | **C** | Sr.No, Location, Product Name, Qty |

2. **Extracts line items** — product name, quantity, location, dimensions, materials, and any brand hints.

3. **Extracts embedded images** — using ExcelJS, the parser pulls product reference images from the spreadsheet, filters out logos/signatures/icons (by size and position), and auto-detects which column contains the product images.

### 4. Search & Matching — Finding the Best Product

For each RFP line item, the system runs a **multi-channel search** combining up to four signals:

| Channel | What It Compares | Strength |
|---------|-----------------|----------|
| **Text Search** | RFP description → product text embeddings | Good for named products |
| **Image Search** | RFP image description → product text embeddings | Good for visual features |
| **Vision-to-Vision** | RFP image description → product image embeddings | Strongest — same representation space |
| **Combined Search** | Product type + image description → product embeddings | Balanced signal |

**Consensus logic** resolves conflicts:
- If visual and text channels agree → high confidence match
- If text finds a strong name match → trust the name
- If they disagree → trust the visual channel (images are more reliable than vague text descriptions)

**Confidence scoring** maps raw cosine similarity (typically 0.4–0.85) to an intuitive 75–99% range for display.

Each item returns a **primary match** plus **up to 5 alternatives** for human review.

### 5. Session Management — Interactive Review via Telegram

The system integrates with **Telegram** through an **n8n workflow** that orchestrates the full review cycle:

```
User sends RFP file via Telegram
        ↓
System creates a session & parses the file
        ↓
For each matched item, the bot presents:
  • RFP requirement + reference image
  • Recommended product + product image
  • Confidence score
  • [Approve] [Reject] [See Alternatives] buttons
        ↓
User reviews each item interactively
        ↓
System generates PowerPoint with approved items only
        ↓
PPT sent back to user via Telegram
```

### 6. Output — Professional PowerPoint Response

The final deliverable is a **branded PowerPoint presentation** containing:

- **Title slide** — client name, date, total item count
- **One slide per approved item** with:
  - RFP requirement description
  - Recommended product details (name, brand, specs)
  - Product image from the catalog
  - Original RFP reference image (if available)
  - Confidence score and match source
  - Quantity and location

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Node.js + Express.js | REST API server |
| **Database** | PostgreSQL + pgvector | Vector similarity search |
| **Text Embeddings** | OpenAI `text-embedding-3-small` | 1,536-dim semantic vectors |
| **Vision AI** | Claude Sonnet (primary), GPT-4o (fallback) | Image-to-text description |
| **Web Scraping** | Playwright | Brand catalog ingestion |
| **Excel Parsing** | XLSX + ExcelJS | RFP document processing |
| **PDF Extraction** | pdf-parse | Spec sheet text extraction |
| **Presentation** | PptxGenJS | PowerPoint generation |
| **Bot Orchestration** | n8n + Telegram Bot API | Interactive user workflow |
| **Scheduling** | node-cron | Weekly data sync |

---

## Database Schema

```
┌─────────────────────┐     ┌──────────────────────────┐
│      brands          │     │   product_families        │
│  (HAY, Muuto,       │◄────│  (Hush, Always, About...) │
│   NaughtOne)        │     └──────────┬───────────────┘
└─────────────────────┘                │
                           ┌───────────┼───────────┬──────────────┐
                           ▼           ▼           ▼              ▼
                 ┌──────────────┐ ┌─────────┐ ┌──────────┐ ┌───────────┐
                 │ variants_v2  │ │ images  │ │  specs   │ │ resources │
                 │ (Hush Chair, │ │ (8000+) │ │(dims,wt) │ │(PDFs,CAD) │
                 │  Hush Sofa)  │ │         │ │          │ │           │
                 └──────────────┘ └─────────┘ └──────────┘ └───────────┘

┌──────────────────────────┐     ┌────────────────────────┐
│ product_family_embeddings │     │     rfp_sessions       │
│  • family_description     │     │  • chat_id, status     │
│  • image_description      │     │  • client_name         │
└──────────────────────────┘     └──────────┬─────────────┘
                                            │
                                            ▼
                                 ┌────────────────────────┐
                                 │   rfp_session_items     │
                                 │  • matched product      │
                                 │  • confidence score     │
                                 │  • review_status        │
                                 │  • alternatives (top 5) │
                                 └────────────────────────┘
```

---

## Key Design Decisions

1. **Vision-to-Vision matching** — Rather than trying to match raw images directly, both the RFP reference image and the catalog product image are first described by Vision AI into text, then compared in the same embedding space. This proved to be the strongest matching signal.

2. **Multi-channel fusion** — No single search channel is reliable enough alone. Combining text, image, and vision-to-vision signals with consensus logic dramatically improves accuracy.

3. **Smart image selection for embeddings** — Not all product images are equal. Front and three-quarter angle shots on clean backgrounds produce far better Vision AI descriptions than lifestyle or group photos.

4. **Two-schema approach** — The legacy flat schema (`products` + `product_variants`) supports the original scraped data, while the new normalized schema (`product_families` + `product_variants_v2` + `technical_specs` + `product_images`) enables richer matching. Both are searched in parallel.

5. **Human-in-the-loop** — Despite high AI accuracy, the Telegram review step ensures a human approves every match before it goes into the final presentation. The system provides alternatives to make corrections easy.
