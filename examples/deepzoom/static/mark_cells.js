const overlay = new OpenSeadragon.CanvasOverlayHd(viewer, {
  clearBeforeRedraw: true,
  onRedraw: draw  // 核心：每帧回调
});

let CELLS = [];   // 统一缓存所有细胞的顶点 & 标签
const colors = ['#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', 
                '#fb9a99', '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6'];

                
const cellColorMap = {
    "bcell": "#FF0000",
    "tumor": "#00FFFF",
    'B Cell': '#004488',
    'CD163+ Mac': '#FFD700',
    'CD163- Mac': '#009E60',
    'Cancer cell': '#00D4FF',
    'DNT': '#8B2500',
    'Dendritic Cell': '#B03AAC',
    'Endothelial': '#FFC0CB',
    'Fibroblast': '#FFAA00',
    'Mast cell': '#A1DB00',
    'NK': '#0066BB',
    'Neu': '#44C2A5',
    'Tc': '#FF0000',
    'Th': '#FF6666',
    'Treg': '#FF66B3',
    'Undefined': '#EE7700'
}

function markCells(cells) {
  CELLS = cells;
  viewer.forceRedraw(); // 触发重绘以显示新细胞
}

function clearCells() {
  CELLS = [];
  viewer.forceRedraw(); // 触发重绘以清除细胞
}

/* ---------- 核心绘制函数 ---------- */
function draw({ context, index }) {
  if (CELLS.length === 0) return;

  // 获取当前瓦片信息
  const tile = viewer.world.getItemAt(index);
  if (!tile) return;
  
  // 保存原始上下文状态
  context.save();
  context.globalAlpha = 0.3;
  // 绘制每个细胞
  CELLS.forEach((cell, cellIndex) => {
    let label = cell.label.split('_')[0]; // 只取标签的第一个部分
    let color = "#000"; // 默认颜色
    if (cellColorMap[label]) {
      color = cellColorMap[label];
    } else {
      color = colors[cellIndex % colors.length];
    }
    // context.globalAlpha = 1.0;
    context.beginPath();
    if (cell.vertices.length === 1) {
      const point = cell.vertices[0];
      
      context.arc(point.x, point.y, 2, 0, 2 * Math.PI);
      
    } else {
      context.moveTo(cell.vertices[0].x, cell.vertices[0].y);
      for (let i = 1; i < cell.vertices.length; i++) {
        context.lineTo(cell.vertices[i].x, cell.vertices[i].y);
      }
    }
    context.closePath();
    
    // 先绘制多边形内部透明填充
    context.fillStyle = hexToRgba(color, 0.1); // 设置透明度为 10%
    context.fill();
    
    // 再绘制多边形外边框
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.stroke();
    
    // // 绘制标签（如果存在）
    // if (cell.label) {
    //   const center = getPolygonCenter(cell.vertices);
    //   context.fillStyle = '#000';
    //   context.font = 'bold 24px Arial';
    //   context.textAlign = 'center';
    //   context.textBaseline = 'middle';
    //   context.fillText(cell.label, center.x, center.y);
    // }
  });
  
  // 恢复原始上下文状态
  context.restore();
}

/* ---------- 辅助函数：将十六进制颜色转换为 RGBA ---------- */
function hexToRgba(hex, alpha) {
  // 处理带#和不带#的情况
  const hexColor = hex.startsWith('#') ? hex.slice(1) : hex;
  
  // 处理3位短格式
  if (hexColor.length === 3) {
    const r = parseInt(hexColor[0] + hexColor[0], 16);
    const g = parseInt(hexColor[1] + hexColor[1], 16);
    const b = parseInt(hexColor[2] + hexColor[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  
  // 处理6位格式
  if (hexColor.length === 6) {
    const r = parseInt(hexColor.substring(0, 2), 16);
    const g = parseInt(hexColor.substring(2, 4), 16);
    const b = parseInt(hexColor.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  
  // 默认返回黑色
  return `rgba(0, 0, 0, ${alpha})`;
}

/* ---------- 辅助函数：计算多边形中心点 ---------- */
function getPolygonCenter(vertices) {
  let sumX = 0;
  let sumY = 0;
  
  for (const vertex of vertices) {
    sumX += vertex.x;
    sumY += vertex.y;
  }
  
  return {
    x: sumX / vertices.length,
    y: sumY / vertices.length
  };
}

/*
markCells([
  {
    vertices: [
      { x: 11000, y: 11000 },
      { x: 12000, y: 10500 },
      { x: 13000, y: 11500 },
      { x: 12500, y: 12500 }
    ],
    label: "Cell 1"
  },
  {
    vertices: [
      { x: 5000, y: 5000 },
      { x: 6000, y: 6000 },
      { x: 7000, y: 7000 }
    ],
    label: "Cell 2"
  }
]);
*/