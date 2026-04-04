# RFP Excel File Upload Guidelines

## File Format
- **Supported**: `.xlsx` files only
- **One sheet per file** is recommended (multiple sheets are supported but each is parsed independently)

## Header Row Rules
- Must appear within the **first 25 rows**
- Must be a **single row** — no merged cells, no multi-row headers, no sub-header rows
- Each column header must be in its **own cell**

## Required Columns

| Column | Accepted Header Names |
|--------|----------------------|
| Serial No | `S No`, `SL NO`, `Sl.No`, `Sr.No`, `Nos`, `No.` |
| Description | `Description`, `Item Description`, `Product Name`, `Item`, `Specification` |
| Quantity | `Qty`, `Quantity`, `Total Quantity` |

## Optional Columns

| Column | Accepted Header Names |
|--------|----------------------|
| Unit | `Unit`, `UoM` |
| Location | `Location` |
| Code | `Code`, `Item Code` |
| Image | Embedded images in any column (auto-detected) |

## Data Row Rules
- Data must start on the **row immediately after** the header
- **Serial number** starts a new item — can be whole numbers (`1, 2, 3`) or decimal (`1.00, 1.01`)
- **Multi-row items are supported** — only the first row needs a serial number, unit, and qty. Following rows without a serial number are treated as continuation (extra description, specs, images)
- **Blank rows** between items are fine (they are skipped)
- **Embedded images** are picked up automatically if placed in the description/image column area

## Things to Avoid
- **Do NOT use merged cells** in the header row
- **Do NOT split quantity** across multiple columns (e.g., Floor 1 Qty, Floor 2 Qty) — use a single `Qty` or `Total Quantity` column
- **Do NOT put** `Total`, `Sub-Total`, `GST`, `Terms & Conditions`, or `Thank You` **in any data row** — these words signal the end of items. Only use them at the very bottom after all items
- **Do NOT use multi-row merged headers** (e.g., "Floor Wise Qty" spanning 4 columns with sub-headers below)

## Example Layout (Recommended)

```
| SL NO | CODE | ITEM DESCRIPTION              | UNIT | QTY | RATE | AMOUNT | REMARKS |
|-------|------|-------------------------------|------|-----|------|--------|---------|
| 1.00  | TB-1 | Table - 3000mm x 1200mm       | Nos  | 2   |      |        |         |
|       |      | Finish: Veneer, Legs: Wooden  |      |     |      |        |         |
|       |      | [embedded image]              |      |     |      |        |         |
| 1.01  | CH-1 | Chair                         | Nos  | 16  |      |        |         |
|       |      | Upholstery: Fabric            |      |     |      |        |         |
```

## Quick Checklist Before Upload
- [ ] Header row has no merged cells
- [ ] Single `Qty` column (not split by floor/zone)
- [ ] No "Total" or "GST" text in data rows
- [ ] Each item has a serial number on its first row
- [ ] File is `.xlsx` format
