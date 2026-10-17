---
library_name: transformers.js
tags:
- background-removal
- mask-generation
- Dichotomous Image Segmentation
- Camouflaged Object Detection
- Salient Object Detection
repo_url: https://github.com/ZhengPeng7/BiRefNet
pipeline_tag: image-segmentation
license: mit
base_model:
- ZhengPeng7/BiRefNet_lite
---
<h1 align="center">Bilateral Reference for High-Resolution Dichotomous Image Segmentation</h1>

<div align='center'>
    <a href='https://scholar.google.com/citations?user=TZRzWOsAAAAJ' target='_blank'><strong>Peng Zheng</strong></a><sup> 1,4,5,6</sup>,&thinsp;
    <a href='https://scholar.google.com/citations?user=0uPb8MMAAAAJ' target='_blank'><strong>Dehong Gao</strong></a><sup> 2</sup>,&thinsp;
    <a href='https://scholar.google.com/citations?user=kakwJ5QAAAAJ' target='_blank'><strong>Deng-Ping Fan</strong></a><sup> 1*</sup>,&thinsp;
    <a href='https://scholar.google.com/citations?user=9cMQrVsAAAAJ' target='_blank'><strong>Li Liu</strong></a><sup> 3</sup>,&thinsp;
    <a href='https://scholar.google.com/citations?user=qQP6WXIAAAAJ' target='_blank'><strong>Jorma Laaksonen</strong></a><sup> 4</sup>,&thinsp;
    <a href='https://scholar.google.com/citations?user=pw_0Z_UAAAAJ' target='_blank'><strong>Wanli Ouyang</strong></a><sup> 5</sup>,&thinsp;
    <a href='https://scholar.google.com/citations?user=stFCYOAAAAAJ' target='_blank'><strong>Nicu Sebe</strong></a><sup> 6</sup>
</div>

<div align='center'>
    <sup>1 </sup>Nankai University&ensp;  <sup>2 </sup>Northwestern Polytechnical University&ensp;  <sup>3 </sup>National University of Defense Technology&ensp; <sup>4 </sup>Aalto University&ensp;  <sup>5 </sup>Shanghai AI Laboratory&ensp;  <sup>6 </sup>University of Trento&ensp; 
</div>

|            *DIS-Sample_1*        |             *DIS-Sample_2*        |
| :------------------------------: | :-------------------------------: |
| <img src="https://drive.google.com/thumbnail?id=1ItXaA26iYnE8XQ_GgNLy71MOWePoS2-g&sz=w400" /> |  <img src="https://drive.google.com/thumbnail?id=1Z-esCujQF_uEa_YJjkibc3NUrW4aR_d4&sz=w400" /> |

For more information, check out the official [repository](https://github.com/ZhengPeng7/BiRefNet).

## Usage (Transformers.js)

If you haven't already, you can install the [Transformers.js](https://huggingface.co/docs/transformers.js) JavaScript library from [NPM](https://www.npmjs.com/package/@xenova/transformers) using:
```bash
npm i @huggingface/transformers
```

You can then use the model for image matting, as follows:

```js
import { AutoModel, AutoProcessor, RawImage } from '@huggingface/transformers';

// Load model and processor
const model_id = 'onnx-community/BiRefNet_lite';
const model = await AutoModel.from_pretrained(model_id, { dtype: 'fp32' });
const processor = await AutoProcessor.from_pretrained(model_id);

// Load image from URL
const url = 'https://images.pexels.com/photos/5965592/pexels-photo-5965592.jpeg?auto=compress&cs=tinysrgb&w=1024';
const image = await RawImage.fromURL(url);

// Pre-process image
const { pixel_values } = await processor(image);

// Predict alpha matte
const { output_image } = await model({ input_image: pixel_values });

// Save output mask
const mask = await RawImage.fromTensor(output_image[0].sigmoid().mul(255).to('uint8')).resize(image.width, image.height);
mask.save('mask.png');
```

| Input image | Output mask |
|--------|--------|
| ![image/png](https://cdn-uploads.huggingface.co/production/uploads/61b253b7ac5ecaae3d1efe0c/cRw4xmlhgkCZ72qJckrps.png) | ![image/png](https://cdn-uploads.huggingface.co/production/uploads/61b253b7ac5ecaae3d1efe0c/pcUeTxkZKPRVfT5oDn0Un.png) |

## Citation

```
@article{BiRefNet,
  title={Bilateral Reference for High-Resolution Dichotomous Image Segmentation},
  author={Zheng, Peng and Gao, Dehong and Fan, Deng-Ping and Liu, Li and Laaksonen, Jorma and Ouyang, Wanli and Sebe, Nicu},
  journal={CAAI Artificial Intelligence Research},
  year={2024}
}
```

---

Note: Having a separate repo for ONNX weights is intended to be a temporary solution until WebML gains more traction. If you would like to make your models web-ready, we recommend converting to ONNX using [🤗 Optimum](https://huggingface.co/docs/optimum/index) and structuring your repo like this one (with ONNX weights located in a subfolder named `onnx`).