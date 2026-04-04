# RFP Automation — Complete System Workflow

## Overview

An AI-powered furniture product matching system that takes RFP (Request for Proposal) Excel spreadsheets containing furniture images and descriptions, matches them against a product catalog (Muuto, HAY, NaughtOne), and generates PowerPoint presentations with approved matches.

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js (Express.js) |
| Image Embeddings | SigLIP (`Xenova/siglip-base-patch16-224`) — 768-dim vectors |
| Text Embeddings | OpenAI `text-embedding-3-large` — 3072-dim vectors |
| Vector Database | PostgreSQL + pgvector extension |
| Image Description | Claude Sonnet 4.6 (primary) / GPT-4o (fallback) |
| AI Reranking | GPT-4o-mini |
| AI Verification | GPT-4o-mini |
| Image Processing | Sharp (resize to 224x224) |
| Excel Parsing | XLSX + ExcelJS (images) |
| PPT Generation | pptxgenjs |
| Frontend | React + Vite + Tailwind CSS |
| Authentication | JWT (jsonwebtoken + bcryptjs) |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      FRONTEND (React)                       │
│                                                             │
│  Login ──→ Upload ──→ Review ──→ Summary ──→ PPT Download   │
│                  (progress polling while processing)        │
└──────────┬──────────────┬──────────────┬────────────────────┘
           │              │              │
           ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXPRESS API (Node.js)                     │
│                                                             │
│   POST /api/auth/login, /api/auth/register                  │
│   POST /api/sessions/:id/process (returns immediately)      │
│   GET  /api/sessions/:id/progress (polling)                 │
│   POST /api/match (single image)                            │
│   POST /api/sessions/:id/items/:itemId/review               │
│   POST /api/sessions/:id/generate                           │
│                                                             │
│   All routes except /api/auth and /api/health require JWT   │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│              BACKGROUND PROCESSING ENGINE                    │
│                                                             │
│  • Processes items sequentially (concurrency=1)             │
│  • Saves each item to DB as it completes                    │
│  • Rate limit throttling between steps (3-5s gaps)          │
│  • Auto-retry on 429 errors (15s, then 30s)                │
│  • Retry pass for failed items after all batches            │
│                                                             │
│  Per Item Pipeline:                                         │
│    Step 0: Image Description (GPT-4o-mini)                  │
│        ↓ 3s wait                                            │
│    Step 1: Hybrid Search (SigLIP 70% + Text 30% via RRF)   │
│        ↓                                                    │
│    Step 2: AI Reranking (GPT-4o-mini, 10 images)            │
│        ↓ check: SigLIP sim ≥ 0.85 AND reranker agrees?     │
│        ├── YES → Skip Step 3 (save ~50% cost)               │
│        └── NO  → 5s wait → Step 3                           │
│    Step 3: AI Verification (GPT-4o-mini, 15 candidates)     │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│               PostgreSQL + pgvector                          │
│                                                             │
│  users (JWT auth)                                           │
│  products (siglip_embedding 768-dim)                        │
│  product_siglip_images (multi-angle 768-dim)                │
│  product_embeddings (text 3072-dim)                         │
│  rfp_sessions (user_id scoped) / rfp_session_items          │
└─────────────────────────────────────────────────────────────┘
```

---

## End-to-End Flow

### 1. Authentication

```
User visits app → Redirected to /login
    ↓
Register (email + password with strong validation) or Login
    ↓
JWT token stored in localStorage
    ↓
All API calls include Authorization: Bearer <token>
    ↓
Sessions are scoped to the authenticated user
```

### 2. Upload Phase

```
User uploads Excel (.xlsx) + enters Client Name
    ↓
POST /api/sessions/:id/process
    ↓  Returns immediately (processing runs in background)
    ↓
Frontend redirects to /review and starts polling GET /progress
    ↓
┌──────────────────────────────────┐
│ RFP Parser Service               │
│ • Auto-detect format (A-F)       │
│ • Extract line items             │
│ • Parse: name, qty, location,    │
│   brand, category, dimensions,   │
│   materials                      │
└──────────────┬───────────────────┘
               ↓
┌──────────────────────────────────┐
│ Vision Service                   │
│ • Extract embedded images (ExcelJS) │
│ • Skip tiny images (<2KB)        │
│ • Auto-detect image column       │
│ • Smart image-to-item mapping    │
│   (exact row match + nearest     │
│    unmatched fallback)           │
└──────────────┬───────────────────┘
               ↓
         For each item (sequential, 5s gap)...
```

### 3. Matching Pipeline (Per Item)

#### With Image → Full Pipeline (with smart Step 3 skip)

```
RFP Image (base64) + Description ("lounge chair")
    │
    ▼
┌─────────────────────────────────────────────┐
│ STEP 0: AI Image Description                │
│ Model: GPT-4o-mini                          │
│ Cost: ~$0.0003                              │
│                                             │
│ Input:  RFP image + short description       │
│ Output: Rich paragraph describing:          │
│   • Exact product type                      │
│   • Shape/silhouette                        │
│   • Base/leg style                          │
│   • Materials & colors                      │
│   • Design era & distinctive features       │
│                                             │
│ Why: RFP descriptions are minimal.          │
│ This enriches text search to catch products │
│ that image search misses due to angle       │
│ differences.                                │
└──────────────────┬──────────────────────────┘
                   │  (3s rate limit wait)
    ┌──────────────┴──────────────┐
    │                             │
    ▼                             ▼
┌──────────────┐         ┌──────────────────┐
│ SigLIP       │         │ Text Embedding   │
│ (LOCAL/FREE) │         │ (OpenAI)         │
│              │         │                  │
│ 224x224      │         │ text-embedding-  │
│ white bg     │         │ 3-large          │
│ mean pool    │         │ 3072-dim         │
│ L2 normalize │         │ Cost: ~$0.00004  │
│ → 768-dim    │         │                  │
└──────┬───────┘         └────────┬─────────┘
       │                          │
       ▼                          ▼
┌─────────────────────────────────────────────┐
│ STEP 1: Hybrid Vector Search (FREE/LOCAL)   │
│                                             │
│ Image Search (70% weight):                  │
│   • Searches product_siglip_images table    │
│     (5-15 angles per product)               │
│   • Picks BEST matching angle per product   │
│   • Fallback: products.siglip_embedding     │
│   • Returns imageSimilarity (cosine, 0-1)   │
│                                             │
│ Text Search (30% weight):                   │
│   • Searches product_embeddings table       │
│   • Types: product_description,             │
│     image_description                       │
│   • Best similarity per product             │
│                                             │
│ Reciprocal Rank Fusion (RRF):               │
│   RRF_K = 60                                │
│   score = 0.7 × 1/(60+imgRank)             │
│         + 0.3 × 1/(60+txtRank)             │
│                                             │
│ Output: Top 100 candidates                  │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ STEP 2: AI Re-ranking                       │
│ Model: GPT-4o-mini                          │
│ Cost: ~$0.01                                │
│                                             │
│ Input:  RFP image + top 10 candidate images │
│         + text descriptions for top 50      │
│                                             │
│ Rules:                                      │
│   • IGNORE color/fabric differences         │
│   • Focus on STRUCTURE: shape, base/leg     │
│     design, armrests, backrest angle         │
│                                             │
│ Retry: If image URLs timeout, retry         │
│ without candidate images (text-only)        │
│                                             │
│ Output: Top 15 candidates (reordered)       │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ CONFIDENCE CHECK (Cost optimization)        │
│                                             │
│ IF top SigLIP imageSimilarity ≥ 0.85        │
│ AND reranker placed same product #1         │
│ THEN → Skip Step 3 (saves ~$0.005)         │
│        Use synthetic scores (9.5, 9.0...)   │
│        Explanation: "High-confidence match" │
│ ELSE → Run Step 3                           │
└──────────┬────────────────┬─────────────────┘
           │                │
     (skip)│          (5s wait, then run)
           │                ▼
           │  ┌─────────────────────────────────────┐
           │  │ STEP 3: AI Verification              │
           │  │ Model: GPT-4o-mini                   │
           │  │ Cost: ~$0.005                        │
           │  │                                      │
           │  │ Input: RFP image + top 15 candidates │
           │  │                                      │
           │  │ Scoring criteria (priority order):   │
           │  │   1. Shape/silhouette (MOST IMPORTANT)│
           │  │   2. Base/leg design match           │
           │  │   3. Armrest and backrest design     │
           │  │   4. Style match                     │
           │  │   5. Material type                   │
           │  │   6. Color match (LEAST IMPORTANT)   │
           │  │                                      │
           │  │ Output: Top 10 with:                 │
           │  │   • Score (0-10)                     │
           │  │   • Explanation per match             │
           │  └──────────────┬──────────────────────┘
           │                 │
           └────────┬────────┘
                    ▼
              Final Result:
              Top match + 5 alternatives
              with scores & explanations
```

#### Without Image → Text-Only Search

```
Description only ("lounge chair, wood base")
    │
    ▼
┌─────────────────────────────────────────────┐
│ Hybrid Search — Text 100% weight            │
│                                             │
│ • Generates text embedding                  │
│ • Searches product_embeddings               │
│ • No SigLIP, no reranking, no verification  │
│ • Returns top 10 by text similarity         │
└─────────────────────────────────────────────┘
```

### 4. Review Phase

```
┌─────────────────────────────────────────────┐
│ Frontend Review Page                        │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ Processing items... 5 of 14 complete    │ │
│ │ ████████████░░░░░░░░  36%              │ │
│ │ Items appear as they are matched.       │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ For each matched item:                      │
│   ┌───────────┬──────────────┐              │
│   │ RFP Image │ Best Match   │  95% ████▓  │
│   │           │ Image        │              │
│   └───────────┴──────────────┘              │
│   Brand + Product Name                      │
│   AI Explanation (why this match)           │
│                                             │
│   [✓ Approve]  [✗ Reject]                  │
│                                             │
│   ▼ Show 5 Alternatives                    │
│   ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ │
│   │ Alt │ │ Alt │ │ Alt │ │ Alt │ │ Alt │ │
│   │  1  │ │  2  │ │  3  │ │  4  │ │  5  │ │
│   │ 92% │ │ 88% │ │ 85% │ │ 80% │ │ 75% │ │
│   └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ │
│                                             │
│ Filters: All | Pending | Approved | Rejected│
│ Search bar for item names                   │
│ Progress: 8/14 reviewed                     │
│ User profile + logout in sidebar            │
└─────────────────────────────────────────────┘
```

### 5. Export Phase

```
Approved items → POST /api/sessions/:id/generate → PowerPoint download
```

---

## Cost Per Item

| Step | Model | Images Sent | Cost | Skippable? |
|---|---|---|---|---|
| Step 0: Describe | GPT-4o-mini | 1 | ~$0.0003 | No |
| Step 1: Search | text-embedding-3-large + pgvector | 0 | ~$0.00004 | No |
| Step 2: Rerank | GPT-4o-mini | 10 | ~$0.01 | No |
| Step 3: Verify | GPT-4o-mini | 15 | ~$0.005 | Yes (if confident) |

**Per item: ~$0.01 (confident) to ~$0.015 (full pipeline)**
**14-item RFP: ~$0.15-0.25**
**100-item RFP: ~$1.00-1.50**

---

## Database Schema

### Core Tables

```sql
-- Users (JWT authentication)
users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'user',  -- 'admin' or 'user'
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Product catalog (~560 products)
products (
  id UUID PRIMARY KEY,
  name VARCHAR(500),
  slug VARCHAR(500),
  description TEXT,
  category VARCHAR(100),     -- chairs, sofas, tables, storage, etc.
  brand_id INTEGER,          -- FK to brands
  image_url TEXT,            -- Main product image
  image_description TEXT,    -- AI-generated description
  materials TEXT,
  dimensions TEXT,
  source_url TEXT,
  siglip_embedding vector(768),  -- Best single SigLIP embedding
  created_at TIMESTAMP
)

-- Multi-angle SigLIP embeddings (5-15 per product)
product_siglip_images (
  id UUID PRIMARY KEY,
  product_id UUID REFERENCES products(id),
  image_url TEXT,
  image_type VARCHAR(50),    -- product, 3qtr, front, side, detail, lifestyle, group
  siglip_embedding vector(768),
  created_at TIMESTAMP
)

-- Text embeddings (OpenAI text-embedding-3-large)
product_embeddings (
  id UUID PRIMARY KEY,
  product_id UUID REFERENCES products(id),
  embedding_type VARCHAR(50),  -- product_description, image_description
  embedding vector(3072),
  input_text TEXT,
  model VARCHAR(100),
  UNIQUE(product_id, embedding_type)
)

-- Brands
brands (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200),         -- Muuto, HAY, NaughtOne
  slug VARCHAR(200)
)

-- RFP Sessions (user-scoped)
rfp_sessions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) NOT NULL,
  client_name VARCHAR(500),
  status VARCHAR(50),        -- awaiting_file → processing → reviewing → completed
  threshold DECIMAL DEFAULT 0.55,
  file_name VARCHAR(500),
  file_base64 TEXT,
  total_items INTEGER,
  approved_count INTEGER DEFAULT 0,
  rejected_count INTEGER DEFAULT 0,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Matched items per session
rfp_session_items (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES rfp_sessions(id),
  item_index INTEGER,
  rfp_line INTEGER,
  query TEXT,                -- Original RFP item name
  description TEXT,
  quantity INTEGER,
  location TEXT,
  image_description TEXT,    -- AI-generated from RFP image
  match_source VARCHAR(50),  -- hybrid_pipeline | text_only | error
  confidence DECIMAL,        -- 0-1 (score/10)
  product_name VARCHAR(500),
  product_brand VARCHAR(200),
  product_image_url TEXT,
  product_specs JSONB,       -- { materials, dimensions }
  rfp_image_base64 TEXT,     -- Original RFP image
  review_status VARCHAR(20) DEFAULT 'pending',  -- pending | approved | rejected
  alternatives JSONB,        -- Top 5 alternative matches
  selected_alternative INTEGER,
  match_explanation TEXT,     -- AI explanation for main match
  created_at TIMESTAMP
)
```

---

## API Endpoints

### Authentication (Public)

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, returns JWT |
| GET | `/api/auth/me` | Get current user (requires JWT) |

### Session Management (Requires JWT)

| Method | Route | Description |
|---|---|---|
| GET | `/api/sessions` | List user's sessions |
| POST | `/api/sessions` | Create new session |
| GET | `/api/sessions/:id` | Get session details |
| PATCH | `/api/sessions/:id` | Update session (client_name, etc.) |
| POST | `/api/sessions/:id/process` | Start RFP processing (async) |
| GET | `/api/sessions/:id/progress` | Poll processing progress |
| GET | `/api/sessions/:id/items` | Get all matched items |
| GET | `/api/sessions/:id/items/pending` | Get pending items |
| POST | `/api/sessions/:id/items/:itemId/review` | Approve/reject item |
| POST | `/api/sessions/:id/items/:itemId/select-alternative` | Swap to alternative |
| POST | `/api/sessions/:id/generate` | Generate PPT |

### Direct Matching (Requires JWT)

| Method | Route | Description |
|---|---|---|
| POST | `/api/match` | Single image match (multipart form) |

### Health (Public)

| Method | Route | Description |
|---|---|---|
| GET | `/api/health` | Health check |

---

## Key Services

| Service | File | Role |
|---|---|---|
| Auth | `src/services/auth.service.js` | Register, login, JWT token generation/verification |
| Matcher | `src/services/matcher.service.js` | Pipeline orchestrator — `matchFromFile`, `matchFromBase64`, `matchFromText` |
| Hybrid Search | `src/services/hybrid-search.service.js` | SigLIP + text search → RRF merge (returns `imageSimilarity`) |
| Reranker | `src/services/reranker.service.js` | GPT-4o-mini visual reranking (10 images) |
| Verifier | `src/services/verifier.service.js` | GPT-4o-mini verification with scores (skipped when confident) |
| SigLIP Embedding | `src/services/siglip-embedding.service.js` | Image → 768-dim vector (local, free) |
| RFP Parser | `src/services/rfp-parser.service.js` | Excel parser (6 format types: A-F) |
| Vision | `src/services/vision.service.js` | Extract + describe images from Excel |
| Session | `src/services/session.service.js` | Session CRUD + item management (user-scoped) |

---

## Constants & Thresholds

| Constant | Value | Location |
|---|---|---|
| IMAGE_WEIGHT (RRF) | 0.7 (70%) | hybrid-search.service.js |
| TEXT_WEIGHT (RRF) | 0.3 (30%) | hybrid-search.service.js |
| RRF_K | 60 | hybrid-search.service.js |
| Initial fetch per channel | 600 | hybrid-search.service.js |
| Step 1 output | Top 100 | matcher.service.js |
| Step 2 images sent | Top 10 | reranker.service.js |
| Step 2 text candidates | Top 50 | reranker.service.js |
| Step 2 output | Top 10 | reranker.service.js |
| Step 3 input / output | Top 10 → 10 | verifier.service.js |
| Step 3 skip threshold | imageSimilarity ≥ 0.85 + reranker agrees | matcher.service.js |
| SigLIP image size | 224 × 224 | siglip-embedding.service.js |
| SigLIP embedding dim | 768 | siglip-embedding.service.js |
| Text embedding dim | 3072 | text-embedding-3-large |
| Default confidence threshold | 0.55 | session.service.js |
| Min image size (Excel) | 2KB | vision.service.js |
| Processing concurrency | 1 (sequential) | session.controller.js |
| Wait before Step 2 | 3s | matcher.service.js |
| Wait before Step 3 | 5s | matcher.service.js |
| Wait between items | 5s | session.controller.js |
| Retry wait (1st) | 15s | session.controller.js |
| Retry wait (2nd) | 30s | session.controller.js |
| JWT expiry | 7 days | auth.service.js |
| Password min length | 8 chars | auth.routes.js |

---

## Excel Format Support

### Format A
`S No | Description | Image | Lead Time | UoM | Qty | Rate | Amount`

### Format B
`S No | Description (requirement) | Location | Image | UoM | Qty | Description (recommended)`

### Format C
`Sr.no | Image | Location | Product name and code | Qty | Price | Total`

### Format D (BOQ)
`Sl.No | Item Description | Ref Image | Deck Image | Unit | Quantity | ... | Total Quantity`

### Format E (Multi-row)
`Nos | ITEM | SPECIFICATION | UNIT | <location columns> | QTY | RATE | AMOUNT`
Items span two rows: item name on one row, specs/dimensions on the next.

### Format F (Specifications)
`(serial) | LOCATION | Specifications | Proposed Image | Lead Time | Quantity`
Serial numbers may be on a separate row from the data.

Auto-detection scans first 25 rows for header patterns.

---

## Key Design Decisions

### 1. Multi-Angle Image Search
A single catalog image (often lifestyle/group) produces very different SigLIP embeddings than an RFP close-up. Storing 5-15 images per product lets the search pick the best matching angle automatically.

### 2. RRF Over Weighted Average
Raw similarity scores from SigLIP and text-embedding have different distributions. A product at image rank #1 (sim=0.94) and text rank #80 (sim=0.68) gets a mediocre weighted average. RRF uses rank positions which are comparable across modalities.

### 3. Color-Blind Matching
RFPs show products in one color, catalogs in another. Both SigLIP and GPT are "distracted" by color. Explicit prompt instructions to IGNORE color and focus on structure dramatically improved accuracy.

### 4. AI Description Enrichment (Step 0)
RFP descriptions are minimal ("lounge chair"). GPT-4o-mini generates rich descriptions (shape, base type, materials) that power the text search branch, catching products image search misses due to angle differences.

### 5. Smart Step 3 Skipping
When SigLIP cosine similarity ≥ 0.85 AND the reranker agrees on the #1 product, Step 3 (verification) is skipped. This saves ~50% of per-item cost with zero accuracy loss, since both the visual embedding and the AI reranker independently confirmed the same match.

### 6. Async Background Processing
`POST /process` returns immediately. Items are processed sequentially in the background, saved to DB one by one. The frontend polls for progress every 5 seconds and shows items as they appear. Users can start reviewing while processing continues.

### 7. Rate Limit Resilience
OpenAI Tier 1 has 200K TPM. The pipeline uses throttling (3-5s waits between GPT calls), auto-retry with exponential backoff (15s, 30s), and a final retry pass for any items that failed during batch processing.

### 8. Graceful Degradation
- If image URLs timeout during reranking → retry without images (text-only)
- If no image in RFP → fall back to text-only search
- If Claude API unavailable → fall back to GPT-4o for vision
- If rate limited → wait and retry (up to 2 times)

### 9. Sharp Preloading
Sharp must be preloaded to work with `@xenova/transformers`. Start command: `node --require sharp src/index.js`

---

## Running

```bash
# Backend
npm start                    # node --require sharp src/index.js

# Frontend (development)
cd client && npm run dev     # Vite dev server on :5173

# Database migrations (auto-run on startup)
npm run migrate
```

## Environment Variables (.env)

```
# Server
PORT=3000
NODE_ENV=development

# Authentication
JWT_SECRET=<random-64-char-hex>

# Database
DATABASE_URL=postgresql://user:pass@localhost:5555/rfp_automation

# AI APIs
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...   # Optional — enables Claude for image description
```
