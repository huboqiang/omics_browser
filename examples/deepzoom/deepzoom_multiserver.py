#!/usr/bin/env python
#
# deepzoom_multiserver - Example web application for viewing multiple slides
#
# Copyright (c) 2010-2015 Carnegie Mellon University
# Copyright (c) 2021-2024 Benjamin Gilbert
#
# This library is free software; you can redistribute it and/or modify it
# under the terms of version 2.1 of the GNU Lesser General Public License
# as published by the Free Software Foundation.
#
# This library is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
# or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser General Public
# License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with this library; if not, write to the Free Software Foundation,
# Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
#

from __future__ import annotations

from argparse import ArgumentParser
import base64
from collections import OrderedDict
from collections.abc import Callable
from io import BytesIO
import os
from pathlib import Path, PurePath
from threading import Lock
from typing import TYPE_CHECKING, Any, Literal
import zlib
import numpy as np
import ast
import csv

from PIL import Image, ImageCms
from flask import Flask, Response, abort, make_response, render_template, url_for, request, jsonify
import geopandas as gpd
from dask import array as da
from tifffile import TiffFile

if TYPE_CHECKING:
    # Python 3.10+
    from typing import TypeAlias

if os.name == 'nt':
    _dll_path = os.getenv('OPENSLIDE_PATH')
    if _dll_path is not None:
        with os.add_dll_directory(_dll_path):  # type: ignore[attr-defined,unused-ignore]  # noqa: E501
            import openslide
    else:
        import openslide
else:
    import openslide

from openslide import OpenSlide, OpenSlideCache, OpenSlideError, OpenSlideVersionError
from openslide.deepzoom import DeepZoomGenerator

# Optimized sRGB v2 profile, CC0-1.0 license
# https://github.com/saucecontrol/Compact-ICC-Profiles/blob/bdd84663/profiles/sRGB-v2-micro.icc
# ImageCms.createProfile() generates a v4 profile and Firefox has problems
# with those: https://littlecms.com/blog/2020/09/09/browser-check/
SRGB_PROFILE_BYTES = zlib.decompress(
    base64.b64decode(
        'eNpjYGA8kZOcW8wkwMCQm1dSFOTupBARGaXA/oiBmUGEgZOBj0E2Mbm4wDfYLYQBCIoT'
        'y4uTS4pyGFDAt2sMjCD6sm5GYl7K3IkMtg4NG2wdSnQa5y1V6mPADzhTUouTgfQHII5P'
        'LigqYWBg5AGyecpLCkBsCSBbpAjoKCBbB8ROh7AdQOwkCDsErCYkyBnIzgCyE9KR2ElI'
        'bKhdIMBaCvQsskNKUitKQLSzswEDKAwgop9DwH5jFDuJEMtfwMBg8YmBgbkfIZY0jYFh'
        'eycDg8QthJgKUB1/KwPDtiPJpUVlUGu0gLiG4QfjHKZS5maWk2x+HEJcEjxJfF8Ez4t8'
        'k8iS0VNwVlmjmaVXZ/zacrP9NbdwX7OQshjxFNmcttKwut4OnUlmc1Yv79l0e9/MU8ev'
        'pz4p//jz/38AR4Nk5Q=='
    )
)
SRGB_PROFILE = ImageCms.getOpenProfile(BytesIO(SRGB_PROFILE_BYTES))

if TYPE_CHECKING:
    ColorMode: TypeAlias = Literal[
        'default',
        'absolute-colorimetric',
        'perceptual',
        'relative-colorimetric',
        'saturation',
        'embed',
        'ignore',
    ]
    Transform: TypeAlias = Callable[[Image.Image], None]

def calculate_percentile(file_name, percentile=99):
    handle = TiffFile(file_name)
    store = handle.series[-1].levels[-1]
    np_arr = da.from_zarr(store[0].aszarr()).compute()
    return np.percentile(np_arr[np_arr>0], percentile)

class DeepZoomMultiServer(Flask):
    basedir: Path
    cache: _SlideCache


class AnnotatedDeepZoomGenerator(DeepZoomGenerator):
    filename: str
    mpp: float
    transform: Transform

colormap_cache = {}
def load_colormap(path, request):
    cmap_param = request.args.get('cmap')
    if cmap_param:
        cmap = ast.literal_eval(cmap_param)
        colormap_cache[path] = cmap
    else:
        if path in colormap_cache:
            del colormap_cache[path]



def generate_cells_json(gpkg_path, label_prefix=None, label_column=None, crop_region=None, only_center=False):
    """
    
    """
    if crop_region is None:
        crop_region = [0, 0, 16000, 16000]
    
    x_beg, y_beg, x_end, y_end = crop_region
    gdf = gpd.read_parquet(gpkg_path)
    gdf = gdf.cx[x_beg:x_end, y_beg:y_end]

    if 'contour_id' not in gdf.columns:
        gdf["contour_id"] = range(len(gdf))

    cells = []
    
    for idx, row in gdf.iterrows():
        contour_id = row['contour_id']
        geometry = row['geometry']
        
        # 跳过空几何对象
        if geometry.is_empty:
            continue
        
        label = str(contour_id)
        if label_column is not None and label_column in row:
            label_name = row[label_column]
            label = f"{label_name}_{contour_id}"

        if label_prefix is not None:
            label = f"{label_prefix}_{contour_id}"
        
        # 处理不同类型的几何对象
        if geometry.geom_type == 'Polygon':
            # 单个多边形
            cell_data = process_polygon(geometry, label, only_center=only_center)
            if cell_data:
                cells.append(cell_data)
                
        elif geometry.geom_type == 'MultiPolygon':
            # 多个多边形组成的集合
            for i, polygon in enumerate(geometry.geoms):
                polygon_label = f"{label}_{i}" if len(geometry.geoms) > 1 else label
                cell_data = process_polygon(polygon, polygon_label, only_center=only_center)
                if cell_data:
                    cells.append(cell_data)
    
    return cells

def process_polygon(polygon, label, only_center=False):
    """
    处理单个多边形，包括外边界和内部孔洞
    
    参数:
        polygon: Shapely Polygon对象
        label: 多边形标签
    
    返回:
        包含vertices和holes信息的字典
    """
    if polygon.is_empty:
        return None
    
    # 处理外边界
    exterior = polygon.exterior
    coords = list(exterior.coords)
    if coords[0] == coords[-1]:
        coords = coords[:-1]
    
    vertices = []
    holes = []
    if only_center:
        center = polygon.centroid
        vertices.append({
            "x": center.x,
            "y": center.y
        })
    else:
        for coord in coords:
            vertices.append({
                "x": coord[0],
                "y": coord[1]
            })
        
        for interior in polygon.interiors:
            hole_coords = list(interior.coords)
            if hole_coords[0] == hole_coords[-1]:
                hole_coords = hole_coords[:-1]
            
            hole_vertices = []
            for coord in hole_coords:
                hole_vertices.append({
                    "x": coord[0],
                    "y": coord[1]
                })
            
            if hole_vertices:  # 只添加非空的孔洞
                holes.append(hole_vertices)
    
    cell_data = {
        "vertices": vertices,
        "label": label
    }
    
    # 只有当存在孔洞时才添加holes字段
    if holes:
        cell_data["holes"] = holes
    
    return cell_data

def create_app(
    config: dict[str, Any] | None = None,
    config_file: Path | None = None,
) -> Flask:
    # Create and configure app
    app = DeepZoomMultiServer(__name__)
    app.config.from_mapping(
        SLIDE_DIR='.',
        SLIDE_CACHE_SIZE=10,
        SLIDE_TILE_CACHE_MB=128,
        DEEPZOOM_FORMAT='jpeg',
        DEEPZOOM_TILE_SIZE=254,
        DEEPZOOM_OVERLAP=1,
        DEEPZOOM_LIMIT_BOUNDS=True,
        DEEPZOOM_TILE_QUALITY=75,
        DEEPZOOM_COLOR_MODE='default',
    )
    app.config.from_envvar('DEEPZOOM_MULTISERVER_SETTINGS', silent=True)
    if config_file is not None:
        app.config.from_pyfile(config_file)
    if config is not None:
        app.config.from_mapping(config)

    # Set up cache
    app.basedir = Path(app.config['SLIDE_DIR']).resolve(strict=True)
    config_map = {
        'DEEPZOOM_TILE_SIZE': 'tile_size',
        'DEEPZOOM_OVERLAP': 'overlap',
        'DEEPZOOM_LIMIT_BOUNDS': 'limit_bounds',
    }
    opts = {v: app.config[k] for k, v in config_map.items()}
    app.cache = _SlideCache(
        app.config['SLIDE_CACHE_SIZE'],
        app.config['SLIDE_TILE_CACHE_MB'],
        opts,
        app.config['DEEPZOOM_COLOR_MODE'],
    )

    # Helper functions
    def get_slide(user_path: PurePath) -> AnnotatedDeepZoomGenerator:
        try:
            path = (app.basedir / user_path).resolve(strict=True)
        except OSError:
            # Does not exist
            abort(404)
#        if path.parts[: len(app.basedir.parts)] != app.basedir.parts:
#            # Directory traversal
#            abort(404)
        try:
            slide = app.cache.get(path)
            slide.filename = path.name
            return slide
        except OpenSlideError:
            abort(404)

    # Set up routes
    @app.route('/')
    def index() -> str:
        return render_template('files.html', root_dir=_Directory(app.basedir))

    @app.route('/viewer')
    def viewer() -> str:
        return render_template('view.html', root_dir=_Directory(app.basedir))

    @app.route('/mark_bbox/<path:path>')
    def mark_bbox(path):
        csv_file = (app.basedir / "../12.roi" / path / "roi.csv").resolve(strict=True)
        boxes = []
        # 2. 读取 CSV，组装 boxes 列表
        with open(csv_file, newline='') as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                x0 = float(row['x_beg'])
                y0 = float(row['y_beg'])
                x1 = float(row['x_end'])
                y1 = float(row['y_end'])
                boxes.append({
                    'x': x0,
                    'y': y0,
                    'w': x1 - x0,
                    'h': y1 - y0,
                    'label': f'roi_{i}'
                })
                if len(boxes) > 5:
                    break
                
        return jsonify(boxes=boxes)

    @app.route('/unmark_bbox/<path:path>')
    def unmark_bbox(path):
        return jsonify(success=True)

    @app.route('/mark_tissue/<path:path>')
    def mark_tissue(path):
        file_tumor = (app.basedir / "../12.roi" / path / "tumor_region.gpd").resolve(strict=True)
        file_bcell = (app.basedir / "../12.roi" / path / "bcell_region.gpd").resolve(strict=True)
        dict_tumor_cells = generate_cells_json(file_tumor, "tumor")
        dict_bcell_cells = generate_cells_json(file_bcell, "bcell")
        dict_output = dict_tumor_cells + dict_bcell_cells
        return jsonify(boxes=dict_output)

    @app.route('/unmark_tissue/<path:path>')
    def unmark_tissue(path):
        return jsonify(success=True)

    @app.route('/mark_cell/<path:path>')
    def mark_cell(path):
        x_beg = request.args.get('x', type=int, default=0)
        y_beg = request.args.get('y', type=int, default=0)
        w = request.args.get('w', type=int, default=4000)
        h = request.args.get('h', type=int, default=4000)
        x_beg = max(x_beg, 0)
        y_beg = max(y_beg, 0)
        h = min(h, 4000)
        w = min(w, 2*h)
        
        crop_region = [x_beg, y_beg, x_beg + w, y_beg + h]

        file_cells = (app.basedir / "../12.roi" / path / "cell_types.parquet").resolve(strict=True)
        dict_cell_types = generate_cells_json(file_cells, label_column="cell_type", crop_region=crop_region, only_center=True)
        dict_output = dict_cell_types
        return jsonify(boxes=dict_output)

    @app.route('/unmark_cell/<path:path>')
    def unmark_cell(path):
        return jsonify(success=True)


    @app.route('/<path:path>')
    def slide(path: str) -> str:
        slide = get_slide(PurePath(path))
        slide_url = url_for('dzi', path=path)
        load_colormap(path, request)
        return render_template(
            'slide-fullpage.html',
            slide_url=slide_url,
            slide_filename=slide.filename,
            slide_mpp=slide.mpp,
        )

    @app.route('/<path:path>.dzi')
    def dzi(path: str) -> Response:
        slide = get_slide(PurePath(path))
        load_colormap(path, request)
        format = app.config['DEEPZOOM_FORMAT']
        resp = make_response(slide.get_dzi(format))
        resp.mimetype = 'application/xml'
        return resp

    @app.route('/<path:path>_files/<int:level>/<int:col>_<int:row>.<format>')
    def tile(path: str, level: int, col: int, row: int, format: str) -> Response:
        slide = get_slide(PurePath(path))
        format = format.lower()
        if format != 'jpeg' and format != 'png':
            # Not supported by Deep Zoom
            abort(404)
        try:
            tile = slide.get_tile(level, (col, row))
        except ValueError:
            # Invalid level or coordinates
            abort(404)

        cmap = colormap_cache.get(path)
        if cmap:
            tile = apply_colormap(tile, cmap, slide.slide_max)

        slide.transform(tile)
        buf = BytesIO()
        tile.save(
            buf,
            format,
            quality=app.config['DEEPZOOM_TILE_QUALITY'],
            icc_profile=tile.info.get('icc_profile'),
        )
        resp = make_response(buf.getvalue())
        resp.mimetype = 'image/%s' % format
        return resp

    return app

def apply_colormap(image: Image.Image, cmap: list, slide_max: int|float=100) -> Image.Image:
    """
    Apply colormap to image based on pixel intensity.
    
    Args:
        image: PIL Image (H,W) or (H,W,C)
        cmap: List of RGB tuples representing colormap [(r1,g1,b1), (r2,g2,b2), ...]
    
    Returns:
        PIL Image with colormap applied (H,W,3)
    """
    # Convert PIL image to numpy array
    img_array = np.array(image)
    
    # Handle different image dimensions
    if len(img_array.shape) == 2:
        # Grayscale image (H, W)
        intensity = img_array
    elif len(img_array.shape) == 3:
        # Color image (H, W, C) - use mean across channels
        intensity = np.mean(img_array, axis=2)
    else:
        raise ValueError(f"Unsupported image shape: {img_array.shape}")
    
    # Normalize intensity to [0, 1]
    intensity_min = 0
    intensity_max = slide_max
    intensity = np.clip(intensity, intensity_min, intensity_max)
    if intensity_max > intensity_min:
        normalized_intensity = (intensity - intensity_min) / (intensity_max - intensity_min)
    else:
        normalized_intensity = np.zeros_like(intensity)
    
    # Create output RGB image
    h, w = intensity.shape
    rgb_image = np.zeros((h, w, 3), dtype=np.uint8)
    
    # Apply colormap interpolation
    if len(cmap) < 2:
        # Single color or empty colormap
        if len(cmap) == 1:
            rgb_image[:, :] = cmap[0]
        return Image.fromarray(rgb_image, 'RGB')
    
    # Linear interpolation between colormap colors
    num_segments = len(cmap) - 1
    segment_size = 1.0 / num_segments
    
    for i in range(num_segments):
        # Define segment boundaries
        start_val = i * segment_size
        end_val = (i + 1) * segment_size
        
        # Find pixels in this segment
        if i == num_segments - 1:  # Last segment includes end point
            mask = (normalized_intensity >= start_val) & (normalized_intensity <= end_val)
        else:
            mask = (normalized_intensity >= start_val) & (normalized_intensity < end_val)
        
        if not np.any(mask):
            continue
        
        # Get segment colors
        start_color = np.array(cmap[i])
        end_color = np.array(cmap[i + 1])
        
        # Calculate interpolation weights for pixels in this segment
        segment_intensity = normalized_intensity[mask]
        if segment_size > 0:
            weights = (segment_intensity - start_val) / segment_size
        else:
            weights = np.zeros_like(segment_intensity)
        
        # Interpolate colors
        interpolated_colors = (
            start_color[np.newaxis, :] * (1 - weights[:, np.newaxis]) +
            end_color[np.newaxis, :] * weights[:, np.newaxis]
        )
        
        # Apply to output image
        rgb_image[mask] = interpolated_colors.astype(np.uint8)
    
    return Image.fromarray(rgb_image, 'RGB')

class _SlideCache:
    def __init__(
        self,
        cache_size: int,
        tile_cache_mb: int,
        dz_opts: dict[str, Any],
        color_mode: ColorMode,
    ):
        self.cache_size = cache_size
        self.dz_opts = dz_opts
        self.color_mode = color_mode
        self._lock = Lock()
        self._cache: OrderedDict[Path, AnnotatedDeepZoomGenerator] = OrderedDict()
        # Share a single tile cache among all slide handles, if supported
        try:
            self._tile_cache: OpenSlideCache | None = OpenSlideCache(
                tile_cache_mb * 1024 * 1024
            )
        except OpenSlideVersionError:
            self._tile_cache = None

    def get(self, path: Path) -> AnnotatedDeepZoomGenerator:
        with self._lock:
            if path in self._cache:
                # Move to end of LRU
                slide = self._cache.pop(path)
                self._cache[path] = slide
                return slide

        osr = OpenSlide(path)
        if self._tile_cache is not None:
            osr.set_cache(self._tile_cache)
        slide = AnnotatedDeepZoomGenerator(osr, **self.dz_opts)
        try:
            mpp_x = osr.properties[openslide.PROPERTY_NAME_MPP_X]
            mpp_y = osr.properties[openslide.PROPERTY_NAME_MPP_Y]
            slide.mpp = (float(mpp_x) + float(mpp_y)) / 2
        except (KeyError, ValueError):
            slide.mpp = 0
        slide.transform = self._get_transform(osr)
        slide.slide_max = calculate_percentile(path, percentile=99.9)
        print("slide.slide_max:", slide.slide_max)
        with self._lock:
            if path not in self._cache:
                if len(self._cache) == self.cache_size:
                    self._cache.popitem(last=False)
                self._cache[path] = slide
        return slide

    def _get_transform(self, image: OpenSlide) -> Transform:
        if image.color_profile is None:
            return lambda img: None
        mode = self.color_mode
        if mode == 'ignore':
            # drop ICC profile from tiles
            return lambda img: img.info.pop('icc_profile')
        elif mode == 'embed':
            # embed ICC profile in tiles
            return lambda img: None
        elif mode == 'default':
            intent = ImageCms.Intent(ImageCms.getDefaultIntent(image.color_profile))
        elif mode == 'absolute-colorimetric':
            intent = ImageCms.Intent.ABSOLUTE_COLORIMETRIC
        elif mode == 'relative-colorimetric':
            intent = ImageCms.Intent.RELATIVE_COLORIMETRIC
        elif mode == 'perceptual':
            intent = ImageCms.Intent.PERCEPTUAL
        elif mode == 'saturation':
            intent = ImageCms.Intent.SATURATION
        else:
            raise ValueError(f'Unknown color mode {mode}')
        transform = ImageCms.buildTransform(
            image.color_profile,
            SRGB_PROFILE,
            'RGB',
            'RGB',
            intent,
            ImageCms.Flags(0),
        )

        def xfrm(img: Image.Image) -> None:
            ImageCms.applyTransform(img, transform, True)
            # Some browsers assume we intend the display's color space if we
            # don't embed the profile.  Pillow's serialization is larger, so
            # use ours.
            img.info['icc_profile'] = SRGB_PROFILE_BYTES

        return xfrm


class _Directory:
    _DEFAULT_RELPATH = PurePath('.')

    def __init__(self, basedir: Path, relpath: PurePath = _DEFAULT_RELPATH):
        self.name = relpath.name
        self.children: list[_Directory | _SlideFile] = []
        for cur_path in sorted((basedir / relpath).iterdir()):
            cur_relpath = relpath / cur_path.name
            if cur_path.is_dir():
                cur_dir = _Directory(basedir, cur_relpath)
                if cur_dir.children:
                    self.children.append(cur_dir)
            elif OpenSlide.detect_format(cur_path):
                self.children.append(_SlideFile(cur_relpath))


class _SlideFile:
    def __init__(self, relpath: PurePath):
        self.name = relpath.name
        self.url_path = relpath.as_posix()


if __name__ == '__main__':
    parser = ArgumentParser(usage='%(prog)s [options] [SLIDE-DIRECTORY]')
    parser.add_argument(
        '-B',
        '--ignore-bounds',
        dest='DEEPZOOM_LIMIT_BOUNDS',
        default=True,
        action='store_false',
        help='display entire scan area',
    )
    parser.add_argument(
        '--color-mode',
        dest='DEEPZOOM_COLOR_MODE',
        choices=[
            'default',
            'absolute-colorimetric',
            'perceptual',
            'relative-colorimetric',
            'saturation',
            'embed',
            'ignore',
        ],
        default='default',
        help=(
            'convert tiles to sRGB using default rendering intent of ICC '
            'profile, or specified rendering intent; or embed original '
            'ICC profile; or ignore ICC profile (compat) [default]'
        ),
    )
    parser.add_argument(
        '-c', '--config', metavar='FILE', type=Path, dest='config', help='config file'
    )
    parser.add_argument(
        '-d',
        '--debug',
        dest='DEBUG',
        action='store_true',
        help='run in debugging mode (insecure)',
    )
    parser.add_argument(
        '-e',
        '--overlap',
        metavar='PIXELS',
        dest='DEEPZOOM_OVERLAP',
        type=int,
        help='overlap of adjacent tiles [1]',
    )
    parser.add_argument(
        '-f',
        '--format',
        dest='DEEPZOOM_FORMAT',
        choices=['jpeg', 'png'],
        help='image format for tiles [jpeg]',
    )
    parser.add_argument(
        '-l',
        '--listen',
        metavar='ADDRESS',
        dest='host',
        default='127.0.0.1',
        help='address to listen on [127.0.0.1]',
    )
    parser.add_argument(
        '-p',
        '--port',
        metavar='PORT',
        dest='port',
        type=int,
        default=5000,
        help='port to listen on [5000]',
    )
    parser.add_argument(
        '-Q',
        '--quality',
        metavar='QUALITY',
        dest='DEEPZOOM_TILE_QUALITY',
        type=int,
        help='JPEG compression quality [75]',
    )
    parser.add_argument(
        '-s',
        '--size',
        metavar='PIXELS',
        dest='DEEPZOOM_TILE_SIZE',
        type=int,
        help='tile size [254]',
    )
    parser.add_argument(
        'SLIDE_DIR',
        metavar='SLIDE-DIRECTORY',
        type=Path,
        nargs='?',
        help='slide directory',
    )

    args = parser.parse_args()
    config = {}
    config_file = args.config
    # Set only those settings specified on the command line
    for k in dir(args):
        v = getattr(args, k)
        if not k.startswith('_') and v is not None:
            config[k] = v
    app = create_app(config, config_file)

    app.run(host=args.host, port=args.port, threaded=True)
