// ========================
// Go To 功能实现
// ========================

/**
 * 跳转到指定的像素坐标和缩放级别
 * @param {number} x - 像素 X 坐标
 * @param {number} y - 像素 Y 坐标  
 * @param {number} zoom - 缩放级别 (可选)
 * @param {boolean} immediately - 是否立即跳转 (可选，默认false有动画)
 */
function goToPixelCoords(x, y, zoom = null, immediately = false) {
  if (!viewer.isOpen()) {
    console.warn('Viewer not ready');
    return;
  }
  
  const imgSize = viewer.world.getItemAt(0).getContentSize();
  
  // 将像素坐标转换为标准化坐标 (0-1 范围)
  const normalizedX = x / imgSize.x;
  const normalizedY = y / imgSize.y;
  
  const point = new OpenSeadragon.Point(normalizedX, normalizedY);
  
  if (zoom !== null) {
    // 同时设置位置和缩放
    viewer.viewport.panTo(point, immediately);
    viewer.viewport.zoomTo(zoom, null, immediately);
  } else {
    // 只设置位置，保持当前缩放
    viewer.viewport.panTo(point, immediately);
  }
  
  console.log(`跳转到像素坐标: (${x}, ${y}), 缩放: ${zoom || '保持当前'}`);
}

/**
 * 跳转到指定区域 (矩形框)
 * @param {number} x - 左上角 X 坐标 (像素)
 * @param {number} y - 左上角 Y 坐标 (像素)
 * @param {number} width - 宽度 (像素)
 * @param {number} height - 高度 (像素)
 * @param {boolean} immediately - 是否立即跳转
 */
function goToRegion(x, y, width, height, immediately = false) {
  if (!viewer.isOpen()) {
    console.warn('Viewer not ready');
    return;
  }
  
  const imgSize = viewer.world.getItemAt(0).getContentSize();
  
  // 转换为标准化坐标
  const rect = new OpenSeadragon.Rect(
    x / imgSize.x,
    y / imgSize.y,
    width / imgSize.x,
    height / imgSize.y
  );
  
  viewer.viewport.fitBounds(rect, immediately);
  console.log(`跳转到区域: (${x}, ${y}) 尺寸: ${width}x${height}`);
}

/**
 * 跳转到指定的缩放级别 (以当前中心点为基准)
 * @param {number} zoomLevel - 缩放级别
 * @param {boolean} immediately - 是否立即跳转
 */
function goToZoomLevel(zoomLevel, immediately = false) {
  viewer.viewport.zoomTo(zoomLevel, null, immediately);
  console.log(`设置缩放级别: ${zoomLevel}`);
}

/**
 * 跳转到图片的特定部分 (百分比)
 * @param {number} xPercent - X 位置百分比 (0-100)
 * @param {number} yPercent - Y 位置百分比 (0-100)
 * @param {number} zoom - 缩放级别 (可选)
 * @param {boolean} immediately - 是否立即跳转
 */
function goToPercent(xPercent, yPercent, zoom = null, immediately = false) {
  const point = new OpenSeadragon.Point(xPercent / 100, yPercent / 100);
  
  viewer.viewport.panTo(point, immediately);
  if (zoom !== null) {
    viewer.viewport.zoomTo(zoom, null, immediately);
  }
  
  console.log(`跳转到百分比位置: (${xPercent}%, ${yPercent}%)`);
}

/**
 * 获取当前视图信息
 */
function getCurrentViewInfo() {
  if (!viewer.isOpen()) return null;
  
  const bounds = viewer.viewport.getBounds(true);
  const imgSize = viewer.world.getItemAt(0).getContentSize();
  const zoom = viewer.viewport.getZoom(true);
  const center = viewer.viewport.getCenter(true);
  
  return {
    // 像素坐标
    pixelBounds: {
      x: Math.round(bounds.x * imgSize.x),
      y: Math.round(bounds.y * imgSize.y),
      width: Math.round(bounds.width * imgSize.x),
      height: Math.round(bounds.height * imgSize.y)
    },
    // 标准化坐标 (0-1)
    normalizedBounds: bounds,
    // 缩放级别
    zoom: zoom,
    // 中心点 (像素)
    centerPixel: {
      x: Math.round(center.x * imgSize.x),
      y: Math.round(center.y * imgSize.y)
    },
    // 中心点 (标准化)
    centerNormalized: center
  };
}

// ========================
// UI 控件示例
// ========================

/**
 * 创建 Go To 控制面板
 */
function createGoToControls() {
  const controlsHtml = `
    <div id="goToControls" style="position: absolute; top: 10px; left: 10px; background: rgba(255,255,255,0.9); padding: 10px; border-radius: 5px; z-index: 1000;">
      <h4>Go To 控制</h4>
      
      <!-- 像素坐标跳转 -->
      <div style="margin-bottom: 10px;">
        <label>像素坐标:</label><br>
        <input type="number" id="gotoX" placeholder="X" style="width: 60px;"> 
        <input type="number" id="gotoY" placeholder="Y" style="width: 60px;">
        <input type="number" id="gotoZoom" placeholder="缩放" style="width: 60px;" step="0.1">
        <button onclick="handleGoToPixel()">跳转</button>
      </div>
      
      <!-- 区域跳转 -->
      <div style="margin-bottom: 10px;">
        <label>区域跳转:</label><br>
        <input type="number" id="regionX" placeholder="X" style="width: 45px;">
        <input type="number" id="regionY" placeholder="Y" style="width: 45px;">
        <input type="number" id="regionW" placeholder="宽" style="width: 45px;">
        <input type="number" id="regionH" placeholder="高" style="width: 45px;">
        <button onclick="handleGoToRegion()">适应区域</button>
      </div>
      
      <!-- 快捷按钮 -->
      <div style="margin-bottom: 10px;">
        <button onclick="goToPercent(50, 50, 1)">居中</button>
        <button onclick="goToPercent(0, 0, 2)">左上角</button>
        <button onclick="goToPercent(100, 100, 2)">右下角</button>
        <button onclick="viewer.viewport.goHome()">复位</button>
      </div>
      
      <!-- 当前位置显示 -->
      <div id="currentViewInfo" style="font-size: 12px; color: #666;">
        <button onclick="showCurrentViewInfo()">显示当前位置</button>
        <div id="viewInfoDisplay"></div>
      </div>
    </div>
  `;
  
  // 添加到页面
  $('body').append(controlsHtml);
}

// ========================
// 事件处理函数
// ========================

function handleGoToPixel() {
  const x = parseInt($('#gotoX').val());
  const y = parseInt($('#gotoY').val());
  const zoom = parseFloat($('#gotoZoom').val()) || null;
  
  if (!isNaN(x) && !isNaN(y)) {
    goToPixelCoords(x, y, zoom);
  } else {
    alert('请输入有效的坐标');
  }
}

function handleGoToRegion() {
  const x = parseInt($('#regionX').val());
  const y = parseInt($('#regionY').val());
  const w = parseInt($('#regionW').val());
  const h = parseInt($('#regionH').val());
  
  if (!isNaN(x) && !isNaN(y) && !isNaN(w) && !isNaN(h)) {
    goToRegion(x, y, w, h);
  } else {
    alert('请输入有效的区域参数');
  }
}

function showCurrentViewInfo() {
  const info = getCurrentViewInfo();
  if (info) {
    const display = `
      <strong>当前视图:</strong><br>
      像素范围: (${info.pixelBounds.x}, ${info.pixelBounds.y}) 
      ${info.pixelBounds.width}×${info.pixelBounds.height}<br>
      中心点: (${info.centerPixel.x}, ${info.centerPixel.y})<br>
      缩放级别: ${info.zoom.toFixed(2)}
    `;
    $('#viewInfoDisplay').html(display);
  }
}

// ========================
// 键盘快捷键
// ========================

$(document).on('keydown', function(e) {
  if (e.ctrlKey || e.metaKey) {
    switch(e.key) {
      case 'h': // Ctrl+H 回到原点
        e.preventDefault();
        viewer.viewport.goHome();
        break;
      case 'c': // Ctrl+C 居中
        e.preventDefault();
        goToPercent(50, 50);
        break;
      case '1': // Ctrl+1 100% 缩放
        e.preventDefault();
        goToZoomLevel(1);
        break;
      case '2': // Ctrl+2 200% 缩放
        e.preventDefault();
        goToZoomLevel(2);
        break;
      case '0': // Ctrl+0 适应窗口
        e.preventDefault();
        viewer.viewport.goHome();
        break;
    }
  }
});