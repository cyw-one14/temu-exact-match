Local regression fixtures derived from the two public product images supplied in
this task, for image matching tests only. They are not extension/demo products.

- Glove original: https://img.kwcdn.com/product/fancy/3a9883af-7884-417d-b850-0599c6430eb2.jpg
- Toothpaste roller original: https://img.kwcdn.com/product/open/44ccfb56032749bcaa0bc9830cace2c8-goods.jpeg
- Subject crops: existing BiRefNet reference masks, 224px RGBA.
- Rotated glove: 12-degree 2D rotation, not a real new camera view.
- Changed toothpaste detail: grayscale grooves removed from one white roller;
  packaging and colored knobs are kept to detect local false positives.
