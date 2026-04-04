# RFP Automation System — Technical Approach

## Overview

An end-to-end system that automates furniture RFP (Request for Proposal) responses. Given an Excel RFP file containing product descriptions and images, the system identifies the closest matching products from a curated furniture database and generates a professional PowerPoint presentation with recommendations.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Dashboard (React)                      │
│  Upload Page → Review Page → Summary Page → History Page     │
│  React 18 + Vite 5 + Tailwind CSS 3 + React Router 6        │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API (JSON + Binary)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                Express.js Backend (Port 3000)                │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────┐  │
│  │  Session  │ │  Search  │ │  Vision   │ │   Embedding  │  │
│  │Controller │ │ Service  │ │  Service  │ │   Service    │  │
│  └────┬─────┘ └────┬─────┘ └─────┬─────┘ └──────┬───────┘  │
│       │             │             │               │          │
│  ┌────┴─────┐ ┌─────┴────┐ ┌─────┴─────┐ ┌──────┴───────┐  │
│  │  RFP     │ │  PPTX    │ │  RFP      │ │   Product    │  │
│  │  Parser  │ │Generator │ │  Parser   │ │   Models     │  │
│  └──────────┘ └──────────┘ └───────────┘ └──────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
     ┌──────────────┐ ┌────────┐ ┌──────────┐
     │  PostgreSQL   │ │ OpenAI │ │Anthropic │
     │  + pgvector   │ │  API   │ │   API    │
     └──────────────┘ └────────┘ └──────────┘
```

---

## Tech Stack

| Layer       | Technology                                          |
|-------------|-----------------------------------------------------|
| Frontend    | React 18, Vite 5, Tailwind CSS 3, React Router 6   |
| Backend     | Node.js, Express.js                                 |
| Database    | PostgreSQL with pgvector extension                  |
| Embeddings  | OpenAI `text-embedding-3-large` (3072 dimensions)   |
| Vision AI   | Claude Sonnet 4.6 (preferred) / GPT-4o (fallback)  |
| Query AI    | GPT-4o (query expansion)                            |
| PPT Gen     | PptxGenJS                                           |
| Excel Parse | ExcelJS + xlsx                                      |

---

## Database Schema

### Core Tables

| Table                     | Purpose                                          | Records |
|---------------------------|--------------------------------------------------|---------|
| `brands`                  | Furniture brands (HAY, Muuto, NaughtOne)         | 3       |
| `products`                | Individual product entries with specs             | 556     |
| `product_families`        | Product family groupings (new schema)            | 48      |
| `product_variants_v2`     | Variant-level data for families                  | -       |
| `product_images`          | Product images per family                        | -       |
| `product_resources`       | PDFs, CAD files, etc.                            | -       |
| `technical_specs`         | Structured specifications per family             | -       |
| `product_embeddings`      | Vector embeddings for legacy products            | 1,769   |
| `product_family_embeddings`| Vector embeddings for product families           | 141     |
| `rfp_sessions`            | RFP processing sessions                          | -       |
| `rfp_session_items`       | Individual line items within a session           | -       |

### Embedding Types

**Product Embeddings** (legacy `product_embeddings` table):
| Type                  | Description                                      |
|-----------------------|--------------------------------------------------|
| `product_description` | Full spec text (brand + name + description + dims + materials + variants) |
| `product_name`        | Just brand + product name (for exact name matching) |
| `image_description`   | AI-generated description of product image        |
| `pdf_content`         | Extracted text from product PDF spec sheets      |
| `full_spec`           | Description + PDF content combined               |

**Family Embeddings** (`product_family_embeddings` table):
| Type                 | Description                                       |
|----------------------|---------------------------------------------------|
| `family_description` | Family description text                           |
| `image_description`  | AI-generated description of family thumbnail      |
| `search_optimized`   | GPT-generated natural language description optimized for RFP search terms |

---

## Complete RFP Processing Flow

### Phase 1: Upload & Parse

```
User uploads Excel RFP file via Web Dashboard
         │
         ▼
POST /api/sessions          →  Create session record in DB
POST /api/sessions/:id/process  →  Send file as base64
         │
         ▼
┌─ RFP Parser (rfp-parser.service.js) ─┐
│  1. Read Excel with xlsx library      │
│  2. Find header row (S No, Description, Qty, Image) │
│  3. Extract line items with:          │
│     - description / query text        │
│     - quantity                        │
│     - location                        │
│     - brand (if specified)            │
│     - data row index (for image matching) │
└───────────────────────────────────────┘
```

### Phase 2: Image Extraction & Description

```
┌─ Vision Service (vision.service.js) ─────────────────────────┐
│                                                                │
│  extractImagesFromExcel(fileBuffer):                          │
│  1. Parse with ExcelJS for embedded images                    │
│  2. Parse with xlsx for header detection                      │
│  3. Find header row → identify "Image" column                │
│  4. Filter images:                                            │
│     - Skip tiny images < 2KB (icons, decorations)            │
│     - Skip images outside data rows (logos, signatures)       │
│     - Only keep images from the image column                  │
│     - If no "Image" header: auto-detect column with most images│
│  5. Deduplicate: keep largest image per row                   │
│                                                                │
│  describeImage(base64, extension):                            │
│  1. If ANTHROPIC_API_KEY set → Claude Sonnet 4.6             │
│  2. Else → GPT-4o Vision                                     │
│  3. Prompt asks for:                                          │
│     - EXACT product type (side table vs coffee table, etc.)   │
│     - Distinctive shape/silhouette                            │
│     - Base/leg type                                           │
│     - Materials and colors                                    │
│     - Any visible brand/product name text                     │
│  4. Returns 2-3 sentence furniture description                │
└───────────────────────────────────────────────────────────────┘
```

### Phase 3: Multi-Channel Product Search

For **each line item**, the system runs 4 parallel search channels and merges results:

```
┌─ Session Controller (session.controller.js) ─────────────────┐
│                                                                │
│  For each RFP item:                                           │
│                                                                │
│  Channel 1: Expanded Text Search                              │
│  ├── GPT-4o expands query with synonyms & descriptors         │
│  │   "Pouf with laptop stand" → "Ottoman pouf footstool       │
│  │    with integrated laptop stand, round cushion..."         │
│  └── Search embeddings with expanded query                    │
│                                                                │
│  Channel 2: Original Text Search                              │
│  └── Search with raw RFP text (catches exact name matches)    │
│                                                                │
│  Channel 3: Image Description Search                          │
│  └── Search using AI-generated description of RFP image       │
│                                                                │
│  Channel 4: Combined Search                                   │
│  └── Search with "clean product type + image description"     │
│                                                                │
│  Merge: Deduplicate by product name, keep highest similarity  │
│  Rank: Sort by similarity, take top 5                         │
└───────────────────────────────────────────────────────────────┘
```

### Phase 4: Search Service Internals

Each search channel internally runs a **3-sub-channel weighted search** across embedding types:

```
┌─ Search Service (search.service.js) ─────────────────────────┐
│                                                                │
│  For each search() call:                                      │
│                                                                │
│  1. Generate query embedding (OpenAI text-embedding-3-large)  │
│                                                                │
│  2. Search product_family_embeddings across 3 types:          │
│     ├── search_optimized (weight: 45%)                        │
│     ├── image_description (weight: 35%)                       │
│     └── family_description (weight: 20%)                      │
│                                                                │
│  3. Multi-channel scoring:                                    │
│     ├── 2+ channels match → weighted average + 5-15% boost   │
│     ├── search_optimized only → full score (no penalty)       │
│     ├── image_description only → 10% penalty                 │
│     └── family_description only → 10% penalty                │
│                                                                │
│  4. Legacy fallback: Also search product_embeddings           │
│     ├── product_description                                   │
│     ├── image_description                                     │
│     └── product_name                                          │
│                                                                │
│  5. Merge family + legacy results, sort by similarity         │
│                                                                │
│  Similarity: pgvector cosine similarity (1 - cosine_distance) │
│  Vector dimensions: 3072                                      │
└───────────────────────────────────────────────────────────────┘
```

### Phase 5: Confidence Scoring

```
┌─ Margin-Based Confidence ────────────────────────────────────┐
│                                                                │
│  After collecting top 5 candidates across all channels:       │
│                                                                │
│  margin = #1 score - #2 score                                 │
│                                                                │
│  If margin > 0.10 (clear winner):                             │
│    → Boost #1 score by up to 15%                              │
│    → multiplier = 1.0 + min(margin × 0.5, 0.15)              │
│                                                                │
│  If margin < 0.03 (ambiguous):                                │
│    → Penalize #1 score by up to 10%                           │
│    → multiplier = 0.90 + (margin / 0.03) × 0.10              │
│                                                                │
│  Threshold: 0.55 (items above = auto-matched, below = review) │
└───────────────────────────────────────────────────────────────┘
```

### Phase 6: Human Review (Web Dashboard)

```
┌─ Review Page ────────────────────────────────────────────────┐
│                                                                │
│  For each item, user sees:                                    │
│  ├── RFP image (extracted from Excel)                         │
│  ├── RFP description text                                     │
│  ├── Matched product image (from DB)                          │
│  ├── Match confidence percentage                              │
│  ├── Product details (name, brand, specs)                     │
│  └── 5 alternative options ranked by similarity               │
│                                                                │
│  Actions:                                                     │
│  ├── Approve (accept current match)                           │
│  ├── Reject (skip this item)                                  │
│  └── Select Alternative (pick from top 5 alternatives)        │
│                                                                │
│  API Endpoints:                                               │
│  ├── POST /api/sessions/:id/items/:itemId/review              │
│  │   Body: { status: "approved" | "rejected" }                │
│  └── POST /api/sessions/:id/items/:itemId/select-alternative  │
│      Body: { alternativeIndex: 1-5 }                          │
└───────────────────────────────────────────────────────────────┘
```

### Phase 7: PowerPoint Generation

```
┌─ PPTX Generator (pptx-generator.service.js) ────────────────┐
│                                                                │
│  POST /api/sessions/:id/generate                              │
│                                                                │
│  1. Fetch all approved items from session                     │
│  2. Download product images from URLs (parallel)              │
│  3. Decode RFP images from base64                             │
│  4. Generate PPTX with PptxGenJS:                             │
│     ├── Title slide (client name, date, item count)           │
│     ├── Product slides (one per approved item):               │
│     │   ├── Product name & brand                              │
│     │   ├── Confidence badge                                  │
│     │   ├── Recommendation text                               │
│     │   ├── Key specifications (bullet points)                │
│     │   ├── RFP reference image (top-right)                   │
│     │   ├── Recommended product image (bottom-right)          │
│     │   └── Quantity + Location footer                        │
│     └── Summary slide (all products listed)                   │
│  5. Return as binary .pptx download                           │
└───────────────────────────────────────────────────────────────┘
```

---

## Web Dashboard Pages

| Page     | Route              | Purpose                                    |
|----------|--------------------|--------------------------------------------|
| Upload   | `/`                | Drag-drop Excel + enter client name        |
| Review   | `/review/:id`      | Review each item, approve/reject/swap      |
| Summary  | `/summary/:id`     | Stats overview + generate PPT download     |
| History  | `/history`         | All past sessions with status and actions  |

---

## API Endpoints

| Method | Endpoint                                    | Purpose                              |
|--------|---------------------------------------------|--------------------------------------|
| GET    | `/api/sessions`                             | List all sessions with item counts   |
| POST   | `/api/sessions`                             | Create a new session                 |
| GET    | `/api/sessions/:id`                         | Get session by ID                    |
| PATCH  | `/api/sessions/:id`                         | Update session fields                |
| POST   | `/api/sessions/:id/process`                 | Upload & process RFP file            |
| GET    | `/api/sessions/:id/items`                   | Get all items for a session          |
| GET    | `/api/sessions/:id/items/pending`           | Get next pending item                |
| POST   | `/api/sessions/:id/items/:itemId/review`    | Approve or reject an item            |
| POST   | `/api/sessions/:id/items/:itemId/select-alternative` | Pick alternative match      |
| POST   | `/api/sessions/:id/generate`                | Generate PPT from approved items     |

---

## Embedding Generation Pipeline

Embeddings must be generated in a specific order due to dependencies:

```
Stage 1: Legacy Product Embeddings
├── product_description (brand + name + description + dims + materials)
├── pdf_content (extracted PDF text)
├── full_spec (description + PDF combined)
└── product_name (brand + name only)

Stage 2: Product Image Embeddings
└── image_description (Vision AI describes each product image → embed text)

Stage 3: Family Image Embeddings
└── image_description (Vision AI describes family thumbnails → embed text)

Stage 4: Family Text Embeddings
└── family_description (family description text → embed)

Stage 5: Search-Optimized Embeddings
└── search_optimized (GPT-4o generates natural RFP-style description
    enriched with image descriptions → embed)
    ⚠ Depends on Stages 3 & 4 (uses image descriptions as input)
```

---

## Key Design Decisions

### 1. Multi-Channel Search over Single-Vector Search
Instead of one embedding per product, we use 5 embedding types per product and 3 per family. This captures different facets of a product (visual appearance, technical specs, natural description) and allows the system to match RFP items that may describe products in any of these ways.

### 2. Query Expansion
RFP descriptions are often terse ("Pouf with laptop stand: 600mm"). GPT-4o expands these into richer queries with synonyms and descriptors, dramatically improving recall without manual keyword engineering.

### 3. Margin-Based Confidence
Rather than trusting raw cosine similarity, the system looks at the gap between #1 and #2. A large margin means high confidence (boost), a tiny margin means ambiguity (penalize). This reduces false positives when multiple products score similarly.

### 4. Vision AI for Image Matching
RFP documents often include product images that carry more information than the text description. Extracting and describing these images creates an additional search signal that catches matches the text alone would miss.

### 5. search_optimized Embeddings
Product descriptions from manufacturer websites are optimized for SEO, not for matching RFP language. GPT-4o rewrites these into natural language descriptions using RFP-style terminology, bridging the vocabulary gap.

### 6. Idempotent Migrations
Since `src/db/migrate.js` runs ALL migrations on every startup (no tracking), every migration must be idempotent. Critical lesson: migration 013 originally had `TRUNCATE` statements that wiped all embeddings on every server restart.

---

## File Structure

```
RFP Automation/
├── client/                          # React Web Dashboard
│   ├── src/
│   │   ├── pages/
│   │   │   ├── UploadPage.jsx       # File upload + client name
│   │   │   ├── ReviewPage.jsx       # Item review with approve/reject
│   │   │   ├── SummaryPage.jsx      # Stats + PPT generation
│   │   │   └── HistoryPage.jsx      # Past session history
│   │   ├── components/
│   │   │   ├── Layout.jsx           # Sidebar + main content layout
│   │   │   └── Sidebar.jsx          # Navigation sidebar
│   │   ├── api.js                   # Axios API client
│   │   ├── App.jsx                  # Router setup
│   │   └── main.jsx                 # Entry point
│   ├── vite.config.js               # Dev proxy to :3000
│   └── tailwind.config.js
│
├── src/
│   ├── controllers/
│   │   └── session.controller.js    # Main RFP processing pipeline
│   ├── services/
│   │   ├── search.service.js        # Multi-channel embedding search
│   │   ├── vision.service.js        # Image extraction + AI description
│   │   ├── embedding.service.js     # OpenAI embedding generation
│   │   ├── pptx-generator.service.js# PowerPoint generation
│   │   ├── rfp-parser.service.js    # Excel RFP parsing
│   │   ├── session.service.js       # Session DB operations
│   │   └── product.service.js       # Product CRUD
│   ├── models/
│   │   ├── embedding.model.js       # pgvector similarity queries
│   │   ├── product.model.js         # Product queries
│   │   ├── product-family.model.js  # Family queries
│   │   └── variant.model.js         # Variant queries
│   ├── routes/
│   │   ├── session.routes.js        # /api/sessions/* routes
│   │   ├── search.routes.js         # /api/search/* routes
│   │   └── products.routes.js       # /api/products/* routes
│   ├── db/
│   │   ├── migrate.js               # Run all SQL migrations on startup
│   │   └── migrations/
│   │       ├── 001-013*.sql         # Schema migrations (idempotent)
│   │       └── ...
│   └── config/
│       ├── database.js              # PostgreSQL pool
│       ├── openai.js                # OpenAI client + model config
│       └── logger.js                # Winston logger
│
├── scripts/                         # Utility scripts
│   ├── regenerate-all-embeddings.js # Full embedding regeneration
│   ├── generate-search-optimized-embeddings.js
│   ├── test-image-search*.js        # Search quality tests
│   └── ...
│
└── .env                             # Environment variables
```

---

## Environment Variables

| Variable              | Purpose                                          |
|-----------------------|--------------------------------------------------|
| `DATABASE_URL`        | PostgreSQL connection string                     |
| `DB_HOST`             | Database host (localhost)                        |
| `DB_PORT`             | Database port (5555)                             |
| `DB_NAME`             | Database name                                    |
| `DB_USER`             | Database user                                    |
| `DB_PASSWORD`         | Database password                                |
| `OPENAI_API_KEY`      | OpenAI API key (embeddings + GPT-4o)             |
| `ANTHROPIC_API_KEY`   | Anthropic API key (Claude Vision — optional)     |
| `EMBEDDING_MODEL`     | `text-embedding-3-large`                         |
| `EMBEDDING_DIMENSIONS`| `3072`                                           |
| `PORT`                | Express server port (default: 3000)              |

---

## Current Product Coverage

| Brand     | Products | Families | Categories                                     |
|-----------|----------|----------|------------------------------------------------|
| HAY       | 229      | -        | chairs, tables, lighting, sofas, storage, etc. |
| Muuto     | -        | -        | chairs, lighting, tables, accessories          |
| NaughtOne | -        | 48       | chairs, tables, sofas, stools, booths          |

**Note**: HAY AAC (About A Chair) line is NOT in the database. Only AAL (About A Lounge) and AAS (About A Stool) series are present.

---

## Known Limitations & Future Improvements

1. **No CLIP Embeddings**: Currently uses text-only embeddings for image matching (Vision AI describes image → embed text). Direct image-to-image CLIP embeddings would improve visual matching.

2. **No Migration Tracking**: `migrate.js` runs ALL migrations every startup. All migrations must be idempotent.

3. **Limited Brand Coverage**: Only 3 brands (HAY, Muuto, NaughtOne). Missing major lines like HAY AAC.

4. **Vision AI Fallback**: Without `ANTHROPIC_API_KEY`, falls back to GPT-4o which gives more generic image descriptions, reducing match quality for visually-driven searches.

5. **No Caching**: Each search generates a new embedding for the query text. Frequently repeated queries could be cached.
