# Implementation Plan: Loved Ones Take Photo

## Overview

Add a "Take Photo" option to the family member photo upload flow in `LovedOnesPage`. This involves creating a new `CameraModal` component and wiring a `PhotoSourcePicker` into the existing form photo area.

## Tasks

- [x] 1. Create the CameraModal component
  - [x] 1.1 Implement `CameraModal` in `src/app/CameraModal.tsx`
    - Define `CameraModalProps` interface with `onCapture: (dataUrl: string) => void` and `onClose: () => void`
    - Implement `startCamera()`: call `navigator.mediaDevices.getUserMedia({ video: true, audio: false })`, assign stream to `videoRef.current.srcObject` and `streamRef.current`
    - Implement `stopCamera()`: stop all tracks in `streamRef.current`, set `streamRef.current = null` (idempotent)
    - Implement `capture()`: guard on `videoRef.current.videoWidth > 0`, create offscreen canvas matching video dimensions, draw frame, call `canvas.toDataURL('image/jpeg', 0.85)`, invoke `onCapture`, call `stopCamera()`
    - Handle `NotAllowedError` → "Camera permission was denied.", `NotFoundError` → "No camera found on this device.", other → "Could not access camera."
    - Disable "Capture" button when `videoWidth === 0` (use `onLoadedMetadata` to track readiness)
    - Show "Close" button when an error is displayed
    - `useEffect` cleanup must call `stopCamera()` on unmount
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 1.2 Write property test: canvas dimensions match video dimensions
    - **Property 4: Canvas dimensions match video dimensions**
    - **Validates: Requirements 3.1**
    - Use fast-check to generate arbitrary `(w, h)` pairs where `w > 0` and `h > 0`; mock a video element with those dimensions and assert the canvas created in `capture()` has matching width/height

  - [ ]* 1.3 Write property test: capture always produces a JPEG data URL
    - **Property 5: Capture always produces a JPEG data URL**
    - **Validates: Requirements 3.2**
    - Use fast-check to generate arbitrary positive integer dimensions; mock canvas `toDataURL` with the real implementation and assert the result starts with `data:image/jpeg;base64,`

  - [ ]* 1.4 Write property test: stopCamera is idempotent
    - **Property 9: stopCamera is idempotent**
    - **Validates: Requirements 4.3, 4.4**
    - Use fast-check to generate arbitrary call counts (0–10); assert that calling `stopCamera` any number of times never throws and always leaves `streamRef.current` as null

  - [ ]* 1.5 Write property test: unknown getUserMedia errors show fallback message
    - **Property 10: Unknown getUserMedia errors show fallback message**
    - **Validates: Requirements 5.3, 5.5**
    - Use fast-check to generate arbitrary error names that are neither `"NotAllowedError"` nor `"NotFoundError"`; mock `getUserMedia` to reject with each; assert error state is "Could not access camera." and stream ref is null

  - [ ]* 1.6 Write property test: no stream held after any getUserMedia error
    - **Property 11: No stream is held after any getUserMedia error**
    - **Validates: Requirements 5.5**
    - Use fast-check to generate arbitrary error types; assert `streamRef.current` is null after each error path

- [x] 2. Checkpoint — Ensure all CameraModal tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Wire PhotoSourcePicker into LovedOnesPage
  - [x] 3.1 Add `showPhotoOptions` and `showCamera` state to `LovedOnesPage`
    - Add `const [showPhotoOptions, setShowPhotoOptions] = useState(false)` and `const [showCamera, setShowCamera] = useState(false)`
    - _Requirements: 1.1_

  - [x] 3.2 Replace direct `fileRef.current?.click()` with PhotoSourcePicker toggle
    - Change the photo circle `onClick` to `setShowPhotoOptions(true)` instead of calling `fileRef.current?.click()` directly
    - Render an inline picker (two buttons: "Upload photo" and "Take photo") when `showPhotoOptions` is true
    - "Upload" button: calls `fileRef.current?.click()` and `setShowPhotoOptions(false)`
    - "Take Photo" button: calls `setShowCamera(true)` and `setShowPhotoOptions(false)`
    - Clicking outside the picker hides it (use `onMouseDown` on the backdrop or a blur handler)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 3.3 Render `CameraModal` and wire `onCapture` / `onClose`
    - Import `CameraModal` and render it when `showCamera` is true
    - `onCapture`: `(dataUrl) => { setForm(f => ({ ...f, picture: dataUrl })); setShowCamera(false) }`
    - `onClose`: `() => setShowCamera(false)`
    - _Requirements: 3.4, 6.1_

  - [ ]* 3.4 Write property test: PhotoSourcePicker always shows both options
    - **Property 1: PhotoSourcePicker always shows both options**
    - **Validates: Requirements 1.1**
    - Use fast-check to generate arbitrary form states; render the photo area and assert both "Upload" and "Take Photo" buttons are present when `showPhotoOptions` is true

  - [ ]* 3.5 Write property test: getUserMedia called with video-only constraints
    - **Property 2: getUserMedia is always called with video-only constraints**
    - **Validates: Requirements 2.1**
    - Mock `navigator.mediaDevices.getUserMedia`; assert it is always called with `{ video: true, audio: false }` regardless of how many times CameraModal is opened

  - [ ]* 3.6 Write property test: video srcObject set to returned stream
    - **Property 3: Video srcObject is set to the returned stream**
    - **Validates: Requirements 2.2**
    - Use fast-check to generate mock MediaStream objects; assert `videoRef.current.srcObject === stream` after `startCamera()` resolves

  - [ ]* 3.7 Write property test: onCapture receives exact data URL from canvas
    - **Property 6: onCapture receives the exact data URL from the canvas**
    - **Validates: Requirements 3.3**
    - Use fast-check to generate arbitrary data URL strings; mock `canvas.toDataURL` to return each; assert the value passed to `onCapture` is identical

  - [ ]* 3.8 Write property test: form.picture round-trip after capture
    - **Property 7: form.picture round-trip after capture**
    - **Validates: Requirements 3.4, 6.1**
    - Use fast-check to generate arbitrary data URL strings; simulate the `onCapture` callback and assert `form.picture` equals the input string exactly

  - [ ]* 3.9 Write property test: camera stream stopped on all exit paths
    - **Property 8: Camera stream is always stopped when CameraModal exits**
    - **Validates: Requirements 3.5, 4.1, 4.2**
    - Use fast-check to generate exit scenarios (capture, cancel, close, unmount); assert all tracks are stopped in every case

  - [ ]* 3.10 Write property test: file upload round-trip preserves data URL
    - **Property 13: File upload round-trip preserves data URL**
    - **Validates: Requirements 7.2**
    - Use fast-check to generate arbitrary data URL strings; simulate `FileReader.readAsDataURL` result and assert `form.picture` is set to the exact same string

  - [ ]* 3.11 Write property test: saved form includes picture in request body
    - **Property 12: Saved form always includes picture data URL in request body**
    - **Validates: Requirements 6.1, 6.2**
    - Use fast-check to generate arbitrary data URL strings; mock `fetch` and assert the `picture` field in the PUT/POST body equals the data URL exactly

- [x] 4. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- The design uses TypeScript (React + TypeScript); all code should follow existing patterns in `LovedOnesPage.tsx`
- No new npm packages are required — `navigator.mediaDevices` is available in Electron's Chromium renderer
- Property tests use fast-check (check if already in devDependencies before adding)
- The backend API and `Person` data model are unchanged; only frontend files need modification
