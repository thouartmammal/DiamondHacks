# Implementation Plan: Reminders Nostalgic Redesign

## Overview

Pure visual reskin of `src/app/RemindersPanel.tsx` to a "plenkacore" analog film aesthetic. All existing logic is preserved; only the JSX return and styling change. Two small presentational sub-components (`FilmStripDivider`, `ReminderCard`) are extracted inline in the same file.

## Tasks

- [x] 1. Add palette constants and grain overlay to RemindersPanel
  - Define the `P` palette const object at the top of `RemindersPanel.tsx` with all Plenkacore_Palette values
  - Replace the root `<div>` background from `#f0f7ff` to the aged-paper radial gradient using `P.cream` → `rgba(92,61,46,0.35)`
  - Add an absolutely-positioned grain overlay `<div>` with the inline SVG `feTurbulence` background at `opacity: 0.17`
  - Remove all blue/white background color values (`#3b82f6`, `#93c5fd`, `#dbeafe`, `#f0f7ff`) from the root layer
  - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 1.1 Write property test for palette exclusion (Property 4)
    - **Property 4: Palette exclusion**
    - **Validates: Requirements 1.3**
    - Use fast-check to assert root background style objects contain no old blue/white hex values across arbitrary renders

- [-] 2. Restyle header, typography, and Back button
  - Update header `backgroundColor` to `rgba(245, 239, 224, 0.92)` and `borderColor` to `P.sepia`
  - Replace h1 "Your reminders" with serif font stack (Georgia, "Times New Roman", serif), `fontSize` ≥ `1.6rem`, color `P.warmBrown`
  - Replace all h2 subheadings with the same serif stack, `fontSize` ≥ `1.1rem`, color `P.warmBrown`
  - Restyle the Back button: `borderColor: P.warmBrown`, `color: P.warmBrown`, remove blue values
  - Remove Tailwind color classes that reference old blue palette from heading and header elements
  - _Requirements: 2.1, 2.2, 2.4, 5.4_

  - [ ]* 2.1 Write property test for heading typography (Property 2)
    - **Property 2: All headings use serif font and warm brown/sepia color**
    - **Validates: Requirements 2.1, 2.2, 2.4**

- [ ] 3. Restyle form inputs, textareas, and primary action buttons
  - Update all `<input>` and `<textarea>` elements: `backgroundColor: P.agedWhite`, `borderColor: P.sepia`, `color: P.warmBrown`
  - Update "Add reminder" and "Add" buttons: `backgroundColor: P.sepia`, `color: P.agedWhite`, remove blue `bg-[#3b82f6]` and `border-[#2563eb]` classes
  - Apply `opacity: 0.5` on disabled state while keeping `backgroundColor: P.sepia` unchanged
  - Update form section cards: `backgroundColor: "rgba(250, 246, 238, 0.75)"`, `borderColor: P.sepia`
  - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [ ]* 3.1 Write property test for disabled button opacity (Property 9)
    - **Property 9: Disabled primary buttons render at reduced opacity**
    - **Validates: Requirements 5.3**

- [ ] 4. Implement FilmStripDivider sub-component
  - Add `FilmStripDivider` function above `RemindersPanel` in the same file
  - Render a dark brown band (`backgroundColor: "#3a2a1a"`, height 34px) with 18 sprocket-hole `<span>` elements
  - Each hole: `width: 14`, `height: 10`, `borderRadius: 3`, `backgroundColor: "#1a0f08"`, `opacity: 0.85`
  - Set `aria-hidden="true"` on the outer div
  - Insert `<FilmStripDivider />` between the forms grid and the "Your list" section
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 4.1 Write unit test for FilmStripDivider aria-hidden
    - Verify the component renders with `aria-hidden="true"`
    - _Requirements: 3.4_

- [ ] 5. Implement ReminderCard sub-component and replace inline list items
  - Add `ReminderCardProps` interface and `ReminderCard` function above `RemindersPanel`
  - Card styles: `backgroundColor: P.agedWhite`, `border: "1.5px solid #c8a97e"`, `boxShadow: "0 4px 14px rgba(92, 61, 46, 0.18)"`, `padding: "16px 16px 32px"`
  - Apply `transform: rotate(${index % 2 === 0 ? "-1.5deg" : "1.5deg"})` via inline style
  - Render title in serif font, `fontSize: "1.05rem"`, `color: P.warmBrown`, `fontWeight: 600`
  - Render source badge: monospace font, `textTransform: "uppercase"`, `border: "1px solid #c8a97e"`, no background fill, `color: P.olive`
  - Render due date in monospace when `dueAt` is non-null
  - Render remove button: `color: P.fadedRed`, `background: "none"`, `border: "none"`, underline text link style
  - Replace the existing `<li>` inline render in the reminders map with `<ReminderCard>`
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.1, 6.2_

  - [ ]* 5.1 Write property test for card rotation alternation (Property 8 / Design Property 1)
    - **Property 8: Card rotation alternates by index**
    - **Validates: Requirements 6.1, 6.2**
    - Use fast-check to generate arrays of reminders and assert even-index cards have negative rotation, odd-index have positive

  - [ ]* 5.2 Write property test for reminder card style invariants (Property 4)
    - **Property 4: Reminder card style invariants**
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [ ]* 5.3 Write property test for source badge uppercase (Property 5 / Design Property 2)
    - **Property 5: Source badge is stamp-style — uppercase, monospace, no fill background**
    - **Validates: Requirements 4.4**
    - Use fast-check to assert badge text equals `sourceLabel(source).toUpperCase()` for all source values

  - [ ]* 5.4 Write property test for due date display (Property 6 / Design Property 3)
    - **Property 6: Due date is displayed in monospace when dueAt is non-null**
    - **Validates: Requirements 4.5**

  - [ ]* 5.5 Write unit test for remove button style
    - Verify `color: "#8b3a2a"`, `background: "none"`, `border: "none"`
    - _Requirements: 4.6_

- [ ] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Restyle error banner and empty state
  - Update error banner: `color: P.fadedRed`, `backgroundColor: "rgba(200, 100, 80, 0.15)"`, `borderColor: "rgba(139, 58, 42, 0.4)"`, preserve `role="alert"`
  - Update empty-state element: dashed border `P.sepia`, serif font, `fontStyle: "italic"`, centered
  - _Requirements: 6.3, 7.5, 7.6_

  - [ ]* 7.1 Write property test for error banner palette (Property 10)
    - **Property 10: Error banner uses warm red-brown palette**
    - **Validates: Requirements 7.5**

  - [ ]* 7.2 Write unit test for empty state card style
    - Verify dashed sepia border and italic serif text when `reminders.length === 0`
    - _Requirements: 6.3_

- [ ] 8. Verify preserved functionality and accessibility
  - Confirm `useEffect` load-on-mount and load-on-focus logic is unchanged
  - Confirm `addFromChat`, `addManual`, and `remove` handlers are unchanged
  - Confirm `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and all other ARIA attributes are intact
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_

  - [ ]* 8.1 Write property test for functional round-trip (Design Property 5)
    - **Property 5: Functional round-trip**
    - **Validates: Requirements 7.3**
    - Mock the API and use fast-check to assert a reminder added via the manual form appears in the rendered list

- [ ] 9. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All styling uses React inline `style` objects — no new CSS framework classes
- `FilmStripDivider` and `ReminderCard` live in the same file as `RemindersPanel`
- Property tests use fast-check (`npm install --save-dev fast-check`)
