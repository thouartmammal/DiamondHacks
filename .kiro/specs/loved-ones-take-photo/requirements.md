# Requirements Document

## Introduction

This feature adds a "Take Photo" option to the family member photo upload flow on the Loved Ones page. Users can capture a photo directly from their device camera within the Electron app, in addition to the existing file upload path. The captured image is stored as a base64 data URL in the same format used by file uploads, requiring no changes to the backend data model.

## Glossary

- **LovedOnesPage**: The React page component that displays the family tree and the add/edit form for family members.
- **CameraModal**: A new self-contained React modal component that manages the full camera capture lifecycle.
- **PhotoSourcePicker**: The inline UI element (two buttons) shown when the user clicks the photo circle, offering "Upload" or "Take Photo" options.
- **MediaDevices_API**: The browser's `navigator.mediaDevices.getUserMedia` API used to access the device camera.
- **MediaStream**: The live video stream object returned by `getUserMedia`.
- **Person**: The data record for a family member, containing a `picture` field that holds a base64 data URL or null.
- **Backend_API**: The Node.js backend REST API that persists Person records to `loved-ones.json`.

## Requirements

### Requirement 1: Photo Source Selection

**User Story:** As a user, I want to choose between uploading a file or taking a photo when adding a family member's picture, so that I can use whichever method is most convenient.

#### Acceptance Criteria

1. WHEN a user clicks the photo circle on the add/edit form, THE LovedOnesPage SHALL display a PhotoSourcePicker with an "Upload" button and a "Take Photo" button.
2. WHEN a user clicks the "Upload" button in the PhotoSourcePicker, THE LovedOnesPage SHALL open the file input dialog and hide the PhotoSourcePicker.
3. WHEN a user clicks the "Take Photo" button in the PhotoSourcePicker, THE LovedOnesPage SHALL open the CameraModal and hide the PhotoSourcePicker.
4. WHEN the PhotoSourcePicker is visible and the user clicks outside of it, THE LovedOnesPage SHALL hide the PhotoSourcePicker.

### Requirement 2: Camera Access and Live Preview

**User Story:** As a user, I want to see a live camera preview before capturing a photo, so that I can frame the shot correctly.

#### Acceptance Criteria

1. WHEN the CameraModal opens, THE CameraModal SHALL request camera access via `navigator.mediaDevices.getUserMedia` with `{ video: true, audio: false }`.
2. WHEN the MediaDevices_API grants camera access, THE CameraModal SHALL display a live video preview using the returned MediaStream.
3. WHEN the CameraModal is open and the video stream is active, THE CameraModal SHALL show a "Capture" button to the user.
4. WHEN the video stream has not yet loaded frames (`videoWidth === 0`), THE CameraModal SHALL disable the "Capture" button until the video is ready.

### Requirement 3: Photo Capture

**User Story:** As a user, I want to capture a photo from the live camera preview, so that it can be used as the family member's profile picture.

#### Acceptance Criteria

1. WHEN a user clicks the "Capture" button and the video stream is ready (`videoWidth > 0`), THE CameraModal SHALL draw the current video frame to an offscreen canvas with dimensions matching the video feed.
2. WHEN the frame is drawn to the canvas, THE CameraModal SHALL call `canvas.toDataURL('image/jpeg', 0.85)` to produce a base64 data URL.
3. WHEN the data URL is produced, THE CameraModal SHALL invoke the `onCapture` callback with the data URL string.
4. WHEN `onCapture` is invoked, THE LovedOnesPage SHALL update the `form.picture` state to the received data URL.
5. WHEN `onCapture` is invoked, THE CameraModal SHALL stop all MediaStream tracks to release the camera hardware.

### Requirement 4: Camera Stream Cleanup

**User Story:** As a user, I want the camera to be released as soon as I'm done with it, so that other applications can use it and the camera indicator light turns off.

#### Acceptance Criteria

1. WHEN a user closes or cancels the CameraModal, THE CameraModal SHALL stop all tracks in the active MediaStream.
2. WHEN the CameraModal unmounts for any reason, THE CameraModal SHALL stop all tracks in the active MediaStream.
3. WHEN `stopCamera` is called and no MediaStream is held, THE CameraModal SHALL complete without error (idempotent behavior).
4. AFTER all tracks are stopped, THE CameraModal SHALL set its internal stream reference to null.

### Requirement 5: Camera Error Handling

**User Story:** As a user, I want to see a clear error message if the camera cannot be accessed, so that I know what went wrong and can use the upload option instead.

#### Acceptance Criteria

1. IF `getUserMedia` throws a `NotAllowedError`, THEN THE CameraModal SHALL display the message "Camera permission was denied."
2. IF `getUserMedia` throws a `NotFoundError`, THEN THE CameraModal SHALL display the message "No camera found on this device."
3. IF `getUserMedia` throws any other error, THEN THE CameraModal SHALL display the message "Could not access camera."
4. WHEN an error message is displayed, THE CameraModal SHALL show a "Close" button allowing the user to dismiss the modal.
5. WHEN an error occurs, THE CameraModal SHALL NOT hold any MediaStream reference.

### Requirement 6: Photo Persistence

**User Story:** As a user, I want the captured photo to be saved with the family member's record, so that it appears on the family tree.

#### Acceptance Criteria

1. WHEN a user saves the add/edit form after capturing a photo, THE LovedOnesPage SHALL include the base64 data URL in the `picture` field of the PUT or POST request to the Backend_API.
2. WHEN the Backend_API receives a Person record with a `picture` field containing a base64 data URL from a camera capture, THE Backend_API SHALL persist it to `loved-ones.json` in the same format as file-uploaded pictures.
3. THE Backend_API SHALL treat camera-captured and file-uploaded base64 data URLs identically.

### Requirement 7: Existing Upload Flow Preservation

**User Story:** As a user, I want the existing file upload option to continue working exactly as before, so that my current workflow is not disrupted.

#### Acceptance Criteria

1. WHEN a user selects "Upload" from the PhotoSourcePicker, THE LovedOnesPage SHALL trigger the existing file input and process the selected file using `FileReader.readAsDataURL`.
2. WHEN a file is selected via the file input, THE LovedOnesPage SHALL update `form.picture` with the resulting data URL, identical to the pre-feature behavior.
3. THE LovedOnesPage SHALL NOT change the backend API contract, the Person data model, or the `loved-ones.json` storage format.
