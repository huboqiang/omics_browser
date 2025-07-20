let isTissueMarked = false;
let isCellMarked = false;

// 1. Mask Tissues
$('#basePathInput').on('change', () => {
    initWorld(); 
    $('.chk').each(function () {
    if ($(this).data('key') !== BASE_LAYER) 
        $(this).prop('checked', false); 
    }); 
    
    isTissueMarked = false;
    $('#tissueToggle').removeClass('active').text('mark tissues');
});

$('#tissueToggle').on('click', function() {
    const bp = $('#basePathInput').val();
    const button = $(this);
    
    if (!isTissueMarked) {
    $.getJSON(`/mark_tissue/${bp}`, data => {
        markCells(data.boxes);
        isTissueMarked = true;
        button.addClass('active').text('unmark tissues');
    }).fail(() => {
        console.error('Failed to mark tissues');
    });
    } else {
    $.getJSON(`/unmark_tissue/${bp}`, () => {
        clearCells();
        isTissueMarked = false;
        button.removeClass('active').text('mark tissues');
    }).fail(() => {
        console.error('Failed to unmark tissues');
    });
    }
});

// 2. Mask Cells
$('#basePathInput').on('change', () => {
    initWorld(); 
    $('.chk').each(function () {
    if ($(this).data('key') !== BASE_LAYER) 
        $(this).prop('checked', false); 
    }); 
    
    isCellMarked = false;
    $('#cellToggle').removeClass('active').text('mark cells');
});

function getCurrentViewportBounds() {
    if (!viewer.isOpen()) {
    return { x: 0, y: 0, w: 16000, h: 16000 };
    }
    
    const imgSize = viewer.world.getItemAt(0).getContentSize();
    const b = viewer.viewport.getBounds(true);
    
    return {
    x: Math.round(b.x * imgSize.x),
    y: Math.round(b.y * imgSize.y),
    w: Math.round(b.width * imgSize.x),
    h: Math.round(b.height * imgSize.y)
    };
}

$('#cellToggle').on('click', function() {
    const bp = $('#basePathInput').val();
    const button = $(this);
    
    if (!isCellMarked) {
    const bounds = getCurrentViewportBounds();
    const url = `/mark_cell/${bp}?x=${bounds.x}&y=${bounds.y}&w=${bounds.w}&h=${bounds.h}`;
    
    $.getJSON(url, data => {
        markCells(data.boxes);
        isCellMarked = true;
        button.addClass('active').text('unmark cells');
        console.log(`Number of cells labeled in viewer (${bounds.x}, ${bounds.y}, ${bounds.w}, ${bounds.h}), n=${data.boxes.length}`);
    }).fail(() => {
        console.error('Failed to mark cells');
    });
    } else {
    $.getJSON(`/unmark_cell/${bp}`, () => {
        clearCells();
        isCellMarked = false;
        button.removeClass('active').text('mark cells');
    }).fail(() => {
        console.error('Failed to unmark cells');
    });
    }
});

// Blenders
$('#blendModeSelect').on('change', function() {
    updateBlendMode(this.value);
});

// checkbox for IHC data
$(document).on('change', '.chk', function () {
    const key = $(this).data('key');
    const range = $(`.range[data-key='${key}']`);
    
    if (key === BASE_LAYER) return;
    
    const opacity = parseFloat(range.val()) || 0.5;
    toggleChannel(key, this.checked, opacity);
});

// 透明度滑块事件处理
$(document).on('input', '.range', function () {
    const key = $(this).data('key');
    const val = parseFloat(this.value);
    
    if (layers[key] && loadingStates[key] === 'loaded') {
    layers[key].setOpacity(val);
    
    // 自动勾选checkbox如果透明度>0
    const chk = $(`.chk[data-key='${key}']`);
    if (val > 0 && !chk.prop('checked')) {
        chk.prop('checked', true);
    }
    }
});