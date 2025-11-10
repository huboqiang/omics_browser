/* ========================
     * 配置
     * ======================*/
    const BASE_LAYER = 'raw_HE';

// ==== 仅此处改为动态构建 (保留原结构作为回退) ====
    const channelNames = (() => {
      const info = (typeof window !== 'undefined') ? window.IHC_LAYER_INFO : null;
      if (!info || !info.genes) {
        return [
          BASE_LAYER,
          "P1_DAPI", 'P1_CD3E', 'P1_MS4A1', 'P1_FCER2', 'P1_LAMP3', 'P1_CR2', 'P1_GLYCAM1', "P1_SampleAF",
          "P2_DAPI", 'P2_CD274', 'P2_ITGAX', 'P2_TPSAB1', 'P2_HLA-DRA', 'P2_CD163', 'P2_CD68', "P2_SampleAF",
          "P3_DAPI", 'P3_NCAM1', 'P3_MPO', 'P3_ACTA2', 'P3_MKI67', 'P3_PECAM1', 'P3_PANK1', "P3_SampleAF",
          "P4_DAPI", 'P4_CD4', 'P4_CD8A', 'P4_FOXP3', 'P4_PDCD1', 'P4_MS4A1', 'P4_IL10', "P4_SampleAF",
        ];
      }
      const panels = info.genes;
      const arr = [BASE_LAYER];
      Object.entries(panels).forEach(([panel, genes]) => {
        (genes || []).forEach(g => arr.push(`${panel}_${g}`));
      });
      return arr;
    })();

    const colorMap = (() => {
      const info = (typeof window !== 'undefined') ? window.IHC_LAYER_INFO : null;
      // 染料 → 颜色表（按波长）
      const dyeColorMap = {
        "DAPI": [0,0,255],
        "Opal 480": [0,255,255],
        "Opal 520": [0,255,0],
        "Opal 570": [255,255,0],
        "Opal 620": [255,165,0],
        "Opal 690": [255,0,0],
        "Opal 780": [255,255,255],
        "Sample AF": [169,169,169],
        "SampleAF": [169,169,169]
      };
      if (!info || !info.genes) {
        return {
          P1_DAPI:[0,0,255], P1_CD3E:[0,255,255], P1_MS4A1:[0,255,0], P1_FCER2:[255,255,0],
          P1_LAMP3:[255,165,0], P1_CR2:[255,0,0], P1_GLYCAM1:[255,255,255], P1_SampleAF:[169,169,169],
          P2_DAPI:[0,0,255], P2_CD274:[0,200,200], P2_ITGAX:[0,200,0], P2_TPSAB1:[200,200,0],
          "P2_HLA-DRA":[205,133,0], P2_CD163:[200,0,0], P2_CD68:[230,230,230], P2_SampleAF:[169,169,169],
          P3_DAPI:[0,0,255], P3_NCAM1:[144,255,144], P3_MPO:[102,255,255], P3_ACTA2:[255,255,128],
          P3_MKI67:[255,200,100], P3_PECAM1:[255,102,102], P3_PANK1:[200,200,200], P3_SampleAF:[169,169,169],
          P4_DAPI:[0,0,255], P4_CD4:[0,255,200], P4_CD8A:[102,255,0], P4_FOXP3:[255,215,0],
          P4_PDCD1:[255,140,0], P4_MS4A1:[255,69,0], P4_IL10:[245,245,245], P4_SampleAF:[169,169,169]
        };
      }
      const panels = info.genes;
      const order = info.order_in_browser || info.orderInBrowser || [];
      const map = {};
      Object.entries(panels).forEach(([panel, genes]) => {
        (genes || []).forEach((gene, idx) => {
          const dye = order[idx]; // 位置对应
          const ch = `${panel}_${gene}`;
            // 若 gene 自身就是染料名（如 DAPI）也兼容
          map[ch] = dyeColorMap[dye] || dyeColorMap[gene] || [150,150,150];
        });
      });
      return map;
    })();
// ==== 动态部分结束，以下保持原样 ====
    let currentBlendMode = 'source-over';

    /* ========================
     * OpenSeadragon Init
     * ======================*/
    const viewer = new OpenSeadragon({
      id: 'view', tileSources: [], prefixUrl: '/static/images/', showNavigator: true, showRotationControl: true,
      animationTime: 0.5, blendTime: 0.1, constrainDuringPan: true, maxZoomPixelRatio: 2, minZoomImageRatio: 1,
      visibilityRatio: 1, zoomPerScroll: 2, timeout: 120000
    });

    const mpp = parseFloat('0');
    viewer.scalebar({ pixelsPerMeter: mpp ? 1e6 / mpp : 0, xOffset: 10, yOffset: 10, barThickness: 3, color: '#555', fontColor: '#333', backgroundColor: 'rgba(255,255,255,0.5)' });

    /* ========================
    * State & Helpers
    * ======================*/
    const layers = {};
    const loadingStates = {}; // 跟踪每个图层的加载状态

    // function tileUrl(basePath, name) { return `/${basePath}/${name}.ome.tif.dzi`; }
    function tileUrl(basePath, name) {
        const baseUrl = `/${basePath}/${name}.ome.tif.dzi`;  
        if (colorMap[name]) {
            const cmapParam = encodeURIComponent(`[(0,0,0), (${colorMap[name].join(',')})]`);
            return `${baseUrl}?cmap=${cmapParam}`;
        }
        return baseUrl;
    }

    /**
     * Show coordinates of the current viewport
     * @param {OpenSeadragon.Viewer} viewer
     * @param {string} outputId
     */
    function attachViewportReporter(viewer, outputId = 'coords') {
      if (viewer.isOpen()) {
        init();
      } else {
        viewer.addOnceHandler('open', init);
      }

      function init() {
        const imgSize = viewer.world.getItemAt(0).getContentSize();
        const outEl = document.getElementById(outputId);
        if (!outEl) return console.warn(`#${outputId} not found`);

        ['viewport-change', 'animation', 'rotate', 'resize']
          .forEach(ev => viewer.addHandler(ev, reportCoords));

        reportCoords();
        function reportCoords() {
          const b = viewer.viewport.getBounds(true);   // image-space rect
          const x = Math.round(b.x * imgSize.x);
          const y = Math.round(b.y * imgSize.y);
          const w = Math.round(b.width * imgSize.x);
          const h = Math.round(b.height * imgSize.y);

          outEl.textContent = `(x, y, w, h) = (${x}, ${y}, ${w}, ${h})`;

          console.debug('Viewport bounds →', b);
          console.debug('Viewport rect →', { x, y, w, h });
        }
      }
    }

    /**
     * Preload a single channel (set opacity to 0, actually invisible)
     */
    function preloadChannel(name, isBase = false) {
      if (loadingStates[name] === 'loading' || loadingStates[name] === 'loaded') {
        return Promise.resolve(layers[name]);
      }
      
      loadingStates[name] = 'loading';
      const basePath = $('#basePathInput').val().replace(/\/+$/, '');
      
      return new Promise((resolve, reject) => {
        viewer.addTiledImage({
          tileSource: tileUrl(basePath, name),
          opacity: isBase ? 1 : 0, // Base layer visible, other layers transparent
          compositeOperation: isBase ? "source-over" : currentBlendMode,
          success: e => {
            layers[name] = e.item;
            loadingStates[name] = 'loaded';
            viewer.world.setItemIndex(e.item, channelNames.indexOf(name));
            
            // Enable corresponding controls
            $(`.range[data-key='${name}']`).prop('disabled', false);
            resolve(e.item);
          },
          error: err => {
            loadingStates[name] = 'error';
            console.error('Preload failed', name, err);
            reject(err);
          }
        });
      });
    }

    /**
     * Preload all channels
     */
    async function preloadAllChannels() {
      console.log('Starting to preload all channels...');
      
      // First load the base layer
      await preloadChannel(BASE_LAYER, true);
      
      // After base layer is loaded, start coordinate display
      attachViewportReporter(viewer, 'coords');
      
      // Preload other layers in parallel
      const otherChannels = channelNames.filter(name => name !== BASE_LAYER);
      const preloadPromises = otherChannels.map(name => 
        preloadChannel(name).catch(err => {
          console.warn(`Layer ${name} preload failed, will retry when user clicks`);
          return null;
        })
      );
      
      try {
        await Promise.allSettled(preloadPromises);
        console.log('All layers preload completed');
      } catch (err) {
        console.warn('Some layers preload failed', err);
      }
    }

    /**
     * Show or hide layer (now synchronous operation)
     */
    function toggleChannel(name, show, opacity = 0.5) {
      if (name === BASE_LAYER) return;
      
      if (layers[name] && loadingStates[name] === 'loaded') {
        // Layer already loaded, directly set opacity
        layers[name].setOpacity(show ? opacity : 0);
      } else if (show) {
        // Layer not loaded but needs to be shown, load immediately
        console.log(`Layer ${name} not preloaded, loading now...`);
        loadingStates[name] = 'loading';
        
        const basePath = $('#basePathInput').val().replace(/\/+$/, '');
        viewer.addTiledImage({
          tileSource: tileUrl(basePath, name),
          opacity: opacity,
          compositeOperation: currentBlendMode,
          success: e => {
            layers[name] = e.item;
            loadingStates[name] = 'loaded';
            viewer.world.setItemIndex(e.item, channelNames.indexOf(name));
            $(`.range[data-key='${name}']`).prop('disabled', false);
            console.log(`Layer ${name} loading completed`);
          },
          error: err => {
            loadingStates[name] = 'error';
            console.error('Loading failed', name, err);
            // If loading fails, uncheck the checkbox
            $(`.chk[data-key='${name}']`).prop('checked', false);
          }
        });
      }
    }

    /**
     * Update blend mode for all layers
     */
    function updateBlendMode(blendMode) {
      currentBlendMode = blendMode;
      
      // Update blend mode for all loaded non-base layers
      for (const [name, layer] of Object.entries(layers)) {
        if (name !== BASE_LAYER && loadingStates[name] === 'loaded') {
          layer.setCompositeOperation(blendMode);
        }
      }
      
      console.log(`Blend mode updated to: ${blendMode}`);
    }

    function initWorld() {
      for (let i = viewer.world.getItemCount() - 1; i >= 0; i--) viewer.world.removeItem(viewer.world.getItemAt(i));
      for (const k in layers) delete layers[k];
      for (const k in loadingStates) delete loadingStates[k];
      

      $('#layerControls').empty();
      const table = $('<table class="control-table"></table>');
      channelNames.forEach(name => {
        const isBase = name === BASE_LAYER;
        const color = colorMap[name]
          ? `rgb(${colorMap[name].join(',')})`
          : 'transparent';

        const row = $(`
          <tr>
            <td>
              <input type="checkbox" class="chk" data-key="${name}" ${isBase ? 'checked' : ''}>
              <span class="layer-name">${name}</span>
            </td>
            <td>
              <span class="color-swatch" 
                    style="background-color: ${color};
                          width:16px; height:16px;
                          display:inline-block;"></span>
            </td>
            <td>
              <input type="range" class="range" data-key="${name}"
                    min="0" max="1" step="0.05" value="0.5" disabled>
            </td>
          </tr>`);

        table.append(row);
      });

      $('#layerControls').append(table);
      
      preloadAllChannels();
    }
    initWorld();