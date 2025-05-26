/* ────────────────── 通用样式（滚动条等，可按需保留） ────────────────── */
const customCSS = `
  ::-webkit-scrollbar { width: 10px; }
  ::-webkit-scrollbar-track { background:#27272a; }
  ::-webkit-scrollbar-thumb { background:#888;border-radius:6px; }
  ::-webkit-scrollbar-thumb:hover { background:#555; }
`;
document.head.append(Object.assign(document.createElement("style"), {textContent: customCSS}));

/* ──────────────── OpenSeadragon 画布容器 ──────────────── */
const OSD_CONTAINER_SELECTOR = '.openseadragon-canvas';
const osdContainer = document.querySelector(OSD_CONTAINER_SELECTOR);
if (!osdContainer) {
  console.warn(`[markBoxesBak] 容器 ${OSD_CONTAINER_SELECTOR} 未找到，将退回到 document.body`);
}

/* ──────────────────── 标注逻辑 ──────────────────── */
function clearMarks() {               // 移除全部标注
  viewer.clearOverlays?.();
}

/**
 * 在 OpenSeadragon viewer 上打 ROI 框
 * @param {Array<{x,y,w,h,left,top,width,height,label,color}>} boxes  像素坐标
 * @param {OpenSeadragon.Viewer} viewer
 */
function markBoxes(boxes = []) {
  // 1. 先清掉旧框
  viewer.clearOverlays?.();

  // 2. 常用工具
  const randColor = () =>
    "#" + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");

  // 3. 获取当前底图的真实像素尺寸
  const tiled = viewer.world.getItemAt(0);          // ⇠ 第 0 张图
  const imgSize = tiled.getContentSize();           // → { x, y }

  // 4. 逐个添加 overlay
  boxes.forEach((b, i) => {
    // 允许两种字段写法：x/y/w/h 或 left/top/width/height
    const px = b.x ?? b.left;
    const py = b.y ?? b.top;
    const pw = b.w ?? b.width;
    const ph = b.h ?? b.height;

    // —— A) 用 API 把像素矩形直接转成 viewport 矩形（推荐）
    const rect = viewer.viewport.imageToViewportRectangle(
      new OpenSeadragon.Rect(px, py, pw, ph)  // ← 像素坐标
    );                                         // :contentReference[oaicite:0]{index=0}

    // —— B) 如你原来那样手算也行：
    // const rect = new OpenSeadragon.Rect(px/imgSize.x, py/imgSize.y,
    //                                    pw/imgSize.x, ph/imgSize.y);

    // 5. 生成 DOM
    const el   = document.createElement("div");
    const col  = b.color || randColor();
    el.className     = "bbox";
    el.dataset.idx   = i;
    el.textContent   = b.label ?? i;
    Object.assign(el.style, {
      pointerEvents: "none",
      boxSizing:     "border-box",
      border:        `4px solid ${col}`,
      background:    "transparent",
      color:         "#fff",
      fontSize:      "24px",
      lineHeight:    "1",
      top:           "-19px",
      padding:       "2px 4px",
      position:      "absolute"       // 必须有，OSD 会改 top/left/width/height
    });

    // 6. 加到 viewer；rotationMode 用 BOUNDING_BOX 能适配旋转  :contentReference[oaicite:1]{index=1}
    viewer.addOverlay({
      element: el,
      location: rect,
      rotationMode: OpenSeadragon.OverlayRotationMode.BOUNDING_BOX
    });
  });
}

/*
boxes = [
  { 
    x: 5939.111715185556/1.0, 
    y: 5675.072741806551/1.0, 
    w: (7950.8592910733005 - 5939.111715185556)/1.0, 
    h: (6657.078763311927 - 5675.072741806551)/1.0, 
    label: "roi_0" 
  },
  { 
    x: 4027.951518092201/1.0, 
    y: 7086.706397720529/1.0, 
    w: (4933.237927241686 - 4027.951518092201)/1.0, 
    h: (8007.33704288182 - 7086.706397720529)/1.0, 
    label: "roi_1" 
  },
  { 
    x: 4832.650548447298/1.0, 
    y: 6595.703386967842/1.0, 
    w: (5838.5243363911695 - 4832.650548447298)/1.0, 
    h: (7209.457150408702 - 6595.703386967842)/1.0, 
    label: "roi_2" 
  },
  { 
    x: 3927.3641392978134/1.0, 
    y: 7209.457150408702/1.0, 
    w: (4128.538896886588 - 3927.3641392978134)/1.0, 
    h: (7393.58327944096 - 7209.457150408702)/1.0, 
    label: "roi_3" 
  },
  { 
    left: 4229.126275680975/1.0, 
    top: 8068.712419225905/1.0, 
    width: (4430.3010332697495 - 4229.126275680975)/1.0, 
    height: (8252.838548258165 - 8068.712419225905)/1.0, 
    label: "roi_4" 
  }
]
markBoxes(boxes);
*/