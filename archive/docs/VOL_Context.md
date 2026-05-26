# VOL Health — System Context

## Overview

VOL Health is a senior living operational stability platform.

It identifies hidden instability in senior living communities and helps leaders make better decisions under pressure by focusing on the signals that actually improve system performance.

The system is designed to:
- detect operational pressure
- measure workforce capacity
- translate both into clear recommendations and priority actions

---

## Core System Model

VOL Health is built on two primary signals:

### 1. Volatility Index (VI)
Measures operational pressure above baseline conditions.

Captures:
- Census volatility
- Acuity variability
- Leadership bandwidth
- Workflow disruption
- Care coordination strain
- Schedule stress
- Coverage fragility
- Overtime pressure
- Survey exposure (SNF contexts)
- Reimbursement pressure (SNF contexts)

VI answers:
→ "How much pressure is the operation under?"

---

### 2. Workforce Stability Index (WSI)
Measures workforce capacity to absorb that pressure.

Captures:
- Coverage stability
- Workforce reliability
- Burnout risk
- Agency dependency
- Hiring pipeline strength
- Overtime reliance
- Call-off frequency
- Open shifts
- Time-to-fill roles

WSI answers:
→ "Can the workforce actually handle that pressure?"

---

### System Insight

The value is not VI or WSI independently.

The value is:
→ the interaction between pressure (VI) and capacity (WSI)

This reveals:
- hidden instability
- false stability (held together by overtime or leadership strain)
- compounding operational and economic risk

---

## User Flow

The system follows a bi-directional flow:

1. User completes VI (volatility-index.html)
2. User completes WSI (wsi.html)
3. System links both via:
   → Assessment Session ID
4. When both are complete:
   → recommendations are generated
5. Results are displayed in UI + sent via email

Users can start with either VI or WSI.

---

## Architecture

### Frontend
- Static HTML / CSS / JavaScript
- Hosted on Vercel
- Pages:
  - index.html
  - volatility-index.html
  - wsi.html
  - shai.html (alignment layer)
  - map.html

### Backend
- Vercel serverless functions:
  - /api/vi
  - /api/wsi
  - /api/assessment-results

### Database
- Notion database (single source of truth)
- All VI + WSI data stored in one table

### Automation
- Gumloop agent reads Notion data
- Generates:
  - Final Recommendation
  - Priority Actions
  - Current Cost narrative

---

## Critical Data Design Decisions

### 1. WSI numeric fields stored as text

Many WSI fields are stored as `rich_text` instead of `number`.

This is intentional.

Reason:
- Notion + Gumloop integration causes write failures with strict number types
- Text fields ensure reliable writes and trigger consistency

Examples:
- Open Shifts per Week
- Monthly Overtime Hours
- Call-offs
- Agency %
- Time-to-fill

IMPORTANT:
→ These values must be parsed as numbers in the API / agent layer

DO NOT convert these fields to number types unless explicitly instructed.

---

### 2. Dual Name Fields

Two fields exist:
- `Name` (Notion title field)
- `Community Name` (rich_text)

Both are written intentionally.

Reason:
- Notion API reliability
- Flexible reads across system

These must remain synchronized.

---

### 3. Finished State Logic

The system uses:
- `VI Submitted`
- `WSI Submitted`
- `Finished State`

To determine:
→ when recommendations are ready

Do not modify this logic without understanding:
- frontend polling
- Gumloop trigger behavior

---

## UI / UX Principles

The system is NOT a dashboard.

It is:
→ a decision support system

Key behavior:
- reduce noise
- highlight priority actions
- guide user to "what to do next"

Avoid:
- clutter
- excessive metrics
- unnecessary complexity

---

## Brand / Messaging Context

VOL Health positioning:

> “VOL Health helps leaders stop reacting to the loudest problem and start acting on what actually improves the operation.”

Core idea:
- operators are not failing
- they are making decisions with incomplete signals

The product provides:
→ clarity under pressure

---

## Guardrails (DO NOT BREAK)

When making changes:

### Do NOT:
- change API routes or structure
- break session linking via Assessment Session ID
- modify Notion field names without full review
- convert WSI text fields to number types
- disrupt VI → WSI → Results flow
- remove localStorage session handling

### Be cautious when:
- editing form inputs
- modifying result rendering
- changing Notion property mappings

---

## Safe Areas for Updates

You CAN safely:
- update UI styling (CSS, layout, spacing)
- improve branding (logo, typography)
- enhance readability of results
- refine copy and messaging
- adjust visual hierarchy

---

## Current Focus

- Improve frontend branding consistency
- Align UI with business card / brand identity
- Maintain system stability while improving UX

---

## Instruction for Codex

Before making changes:
1. Read this file fully
2. Preserve system logic
3. Only modify what is explicitly requested
4. Do not introduce new architecture without instruction
