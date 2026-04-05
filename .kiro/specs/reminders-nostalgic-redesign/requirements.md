# Requirements Document

## Introduction

This feature redesigns the RemindersPanel component with a "plenkacore" / analog film photography aesthetic. The goal is to replace the current clean blue-and-white UI with a warm, nostalgic visual language inspired by physical film photography: aged paper textures, polaroid-style reminder cards, film strip dividers, sepia/cream/olive color palettes, and retro serif typography. All existing functionality (adding, listing, and removing reminders) is preserved; only the visual presentation changes. The app is an Electron desktop app using React + TypeScript with inline styles.

## Glossary

- **RemindersPanel**: The full-screen overlay component at `src/app/RemindersPanel.tsx` that displays and manages reminders.
- **Reminder_Card**: A single reminder item rendered as a polaroid/photo-print style card.
- **Film_Strip_Divider**: A decorative horizontal element styled to resemble the sprocket-hole edge of analog film stock, used to separate page sections.
- **Plenkacore_Palette**: The warm analog color palette: cream (`#f5efe0`), sepia (`#c8a97e`), olive (`#7a7a4a`), warm brown (`#5c3d2e`), faded amber (`#d4a853`), and aged white (`#faf6ee`).
- **Aged_Paper_Background**: A full-page background simulating yellowed, slightly textured photographic paper using CSS gradients and SVG noise filters.
- **Retro_Typography**: Serif or slab-serif font stack (Georgia, "Times New Roman", serif) used for headings; monospace stack for metadata labels.
- **Source_Badge**: A small label on each Reminder_Card indicating how the reminder was created (voice, chat, or manual).
- **Inline_Style**: React inline style objects (`style={{ ... }}`), the project's established styling approach — no CSS framework classes for new visual elements.

---

## Requirements

### Requirement 1: Aged Paper Background

**User Story:** As a user, I want the Reminders page to have a warm, aged-paper background, so that the page immediately feels nostalgic and analog rather than digital.

#### Acceptance Criteria

1. THE RemindersPanel SHALL render a full-bleed background using the Plenkacore_Palette (base color `#f5efe0`) with a subtle radial vignette darkening the edges to approximately `rgba(92, 61, 46, 0.35)`.
2. THE RemindersPanel SHALL overlay an SVG fractal-noise grain filter at opacity between 0.12 and 0.22 on top of the background to simulate film grain texture.
3. THE RemindersPanel SHALL NOT use any blue (`#3b82f6`, `#93c5fd`, `#dbeafe`) or white (`#f0f7ff`) colors from the previous design in the background layer.

---

### Requirement 2: Retro Typography

**User Story:** As a user, I want headings and labels to use a serif or retro-style font, so that the text reinforces the analog film aesthetic.

#### Acceptance Criteria

1. THE RemindersPanel SHALL render the main page heading ("Your reminders") using a serif font stack (Georgia, "Times New Roman", serif) at a size no smaller than `1.6rem`.
2. THE RemindersPanel SHALL render section subheadings ("Chat-style reminder", "Quick add", "Your list") using the same serif font stack at a size no smaller than `1.1rem`.
3. THE RemindersPanel SHALL render metadata labels (source badge text, date/time strings) using a monospace font stack ("Courier New", Courier, monospace) at a size no smaller than `0.7rem`.
4. THE RemindersPanel SHALL use warm brown (`#5c3d2e`) or sepia (`#c8a97e`) as the primary text color for headings, replacing the previous `#1e3a5f` blue.

---

### Requirement 3: Film Strip Dividers

**User Story:** As a user, I want decorative film strip dividers between page sections, so that the layout feels like a physical contact sheet or photo album page.

#### Acceptance Criteria

1. THE RemindersPanel SHALL render a Film_Strip_Divider between the "add reminder" forms section and the "Your list" section.
2. THE Film_Strip_Divider SHALL be implemented as an inline-styled `<div>` containing a repeating pattern of rectangular "sprocket holes" (small dark rounded rectangles spaced evenly) on a dark brown (`#3a2a1a`) horizontal band.
3. THE Film_Strip_Divider SHALL span the full width of its container and have a height between 28px and 40px.
4. THE Film_Strip_Divider SHALL be purely decorative and carry `aria-hidden="true"`.

---

### Requirement 4: Polaroid-Style Reminder Cards

**User Story:** As a user, I want each reminder to appear as a polaroid or photo-print style card, so that the list feels like a collection of physical memory notes.

#### Acceptance Criteria

1. THE Reminder_Card SHALL have a cream/aged-white background (`#faf6ee`), a 1–2px warm brown border (`#c8a97e`), and a box shadow simulating a slight paper lift (`0 4px 14px rgba(92, 61, 46, 0.18)`).
2. THE Reminder_Card SHALL have a thicker bottom padding (at least `2rem`) compared to the top and sides, mimicking the wide white border at the bottom of a polaroid print.
3. THE Reminder_Card SHALL render the reminder title in the serif Retro_Typography style at `1rem`–`1.2rem`, in warm brown (`#5c3d2e`).
4. THE Reminder_Card SHALL render the Source_Badge using a small stamp-style element: monospace font, olive or sepia border, no fill background, uppercase text.
5. WHEN a Reminder_Card is rendered with a `dueAt` value, THE Reminder_Card SHALL display the formatted due date in monospace font below the title.
6. THE Reminder_Card SHALL render the remove action as a small text link or minimal button styled in faded red-brown (`#8b3a2a`) rather than a prominent bordered button.

---

### Requirement 5: Warm-Toned Form Inputs

**User Story:** As a user, I want the text inputs and buttons to match the warm analog palette, so that the interactive elements don't break the nostalgic visual theme.

#### Acceptance Criteria

1. THE RemindersPanel SHALL render all text inputs and textareas with a background of `#faf6ee`, a border color of `#c8a97e`, and text color of `#5c3d2e`.
2. THE RemindersPanel SHALL render primary action buttons ("Add reminder", "Add") with a background of `#c8a97e` (sepia) and text color of `#faf6ee` (aged white), replacing the previous blue button style.
3. WHEN a primary action button is in a disabled state, THE RemindersPanel SHALL render it at reduced opacity (0.45–0.55) without changing its color scheme.
4. THE RemindersPanel SHALL render the "Back" close button using a warm brown border (`#5c3d2e`) and warm brown text, replacing the previous blue style.
5. THE RemindersPanel SHALL render form section cards (the two add-reminder panels) with a background of `rgba(250, 246, 238, 0.75)` and a border of `#c8a97e`.

---

### Requirement 6: Scattered / Slightly Rotated Card Layout

**User Story:** As a user, I want reminder cards to appear slightly rotated or offset, so that the list looks like photos casually spread on a table rather than a rigid digital list.

#### Acceptance Criteria

1. THE RemindersPanel SHALL apply a small CSS rotation transform to each Reminder_Card, alternating between approximately -1.5deg and +1.5deg based on the card's index (even index: negative, odd index: positive).
2. THE RemindersPanel SHALL apply the rotation using an inline `transform` style property, keeping the implementation consistent with the project's inline-style approach.
3. WHEN there are zero reminders, THE RemindersPanel SHALL render an empty-state message styled as a single centered Reminder_Card with dashed sepia border and italic serif text.

---

### Requirement 7: Preserve All Existing Functionality

**User Story:** As a user, I want all reminder features to continue working exactly as before, so that the redesign does not break my ability to add, view, or remove reminders.

#### Acceptance Criteria

1. THE RemindersPanel SHALL continue to load reminders from the API on mount and on window focus, as in the current implementation.
2. THE RemindersPanel SHALL continue to support adding reminders via the chat-style natural language form.
3. THE RemindersPanel SHALL continue to support adding reminders via the quick-add title + datetime form.
4. THE RemindersPanel SHALL continue to support removing individual reminders.
5. WHEN an API error occurs, THE RemindersPanel SHALL display an error message visible to the user, styled with a warm red-brown tone (`#8b3a2a` text, `rgba(200, 100, 80, 0.15)` background) consistent with the new palette.
6. THE RemindersPanel SHALL preserve all existing ARIA roles, labels, and `aria-modal` attributes to maintain accessibility.
