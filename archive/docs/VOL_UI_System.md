# VOL Health UI System

## Core Design Principle

The VOL Health UI should feel calm, executive, and signal-driven.

The interface should reduce noise, not add intensity.

The user should always understand:
1. What signal matters
2. Why it matters
3. What to do next

---

## Brand Feel

VOL Health should feel:
- Clear
- Calm
- Premium
- Operationally grounded
- Executive-friendly
- Signal-driven

Avoid:
- Visual shouting
- Dense walls of text
- Overuse of bold text
- Too many competing calls-to-action
- Excessive metrics without interpretation

---

## Typography

Primary font:
Montserrat

Fallback fonts:
Inter, Arial, Helvetica, sans-serif

### Font Weights

Use:

- 900: Logo only
- 800: Major page titles only, sparingly
- 700: Section headlines
- 600: Important card values and key phrases
- 500: Buttons, labels, short readout summaries
- 400: Body text and explanatory copy

Avoid using 800 or 900 for paragraph text.

---

## Text Colors

Use:

- Primary text: rgba(255,255,255,0.92)
- Body text: rgba(255,255,255,0.78)
- Muted text: rgba(159,178,210,0.90)
- Labels: rgba(255,255,255,0.62)

Avoid pure white for long-form body copy.

---

## Line Heights

Use:

- Hero headline: 1.08
- Section headline: 1.18
- Body copy: 1.55
- Dense readout text: 1.6
- Labels: 1.25

---

## Spacing

Use:

- Page outer margin: 20–24px
- Major section gap: 18–24px
- Card gap: 14–18px
- Standard card padding: 18–22px
- Compact card padding: 14–16px

Cards should feel breathable, not crowded.

---

## Card Hierarchy

Each card should generally follow:

1. Label  
2. Main signal or value  
3. Explanation  
4. Optional next action

### Label Style

Labels should be:
- Small
- Uppercase
- Muted
- 11–12px
- 700–800 weight
- Slight letter spacing

### Main Signal / Value

Main values should use:
- 600–700 weight
- Clear contrast
- Not 900 unless absolutely necessary

### Explanation Text

Explanation text should use:
- 400 weight
- Body text color
- Line height 1.5–1.6

---

## Readout Cards

Readout cards should not use bold paragraphs.

Use:
- Short blocks
- Clear spacing
- Selective emphasis only for key phrases
- Muted body color
- Calm hierarchy

Avoid:
- Dense paragraphs
- All-bold explanations
- Pure white paragraph blocks

---

## Hero Sections

Hero sections should have:

1. One clear headline
2. One short subhead
3. One supporting body line
4. Optional system-flow line

Hero headline:
- 700 weight
- Not oversized
- Max width should remain readable

Hero copy should be scannable and calm.

---

## Signal → Decision Flow

VOL Health should visually reinforce this system flow:

Detect pressure with VI  
→ Measure capacity with WSI  
→ Align response with SHAI  
→ Visualize the path with Stability Map

The treatment should be subtle, premium, and not clutter the UI.

---

## CTA Rules

Every major diagnostic result should make the next action obvious.

Examples:
- After VI: Run WSI to measure workforce capacity
- After WSI: Get final recommendations or view Stability Map
- After results: Review priority actions, email results, or view Stability Map

CTAs should be concise and consistent.

---

## Do Not Change Without Explicit Approval

Do not change:
- API routes
- Notion field mappings
- Assessment Session ID behavior
- localStorage session logic
- VI → WSI → Results flow
- Modal behavior
- Recommendation polling
- Email behavior
- Backend logic

UI changes should preserve system behavior.

---

## Implementation Principle

Prefer small, safe improvements.

Improve:
- readability
- hierarchy
- spacing
- typography
- clarity

Do not redesign the platform unless explicitly requested.