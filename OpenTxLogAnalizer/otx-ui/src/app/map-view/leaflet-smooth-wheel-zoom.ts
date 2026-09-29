import * as L from 'leaflet';

declare module 'leaflet' {
  interface MapOptions {
    smoothWheelZoom?: boolean | string;
    smoothSensitivity?: number;
  }
}

/**
 * Leaflet.SmoothWheelZoom handler for buttery-smooth fractional mouse wheel zooming.
 * Ported and optimized for modern Leaflet / TypeScript.
 */
export const SmoothWheelZoom = (L.Handler as any).extend({
  addHooks: function (this: any) {
    L.DomEvent.on(this._map._container, 'wheel', this._onWheelScroll, this);
  },

  removeHooks: function (this: any) {
    L.DomEvent.off(this._map._container, 'wheel', this._onWheelScroll, this);
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    if (this._zoomAnimationId) {
      cancelAnimationFrame(this._zoomAnimationId);
      this._zoomAnimationId = null;
    }
    this._isWheeling = false;
  },

  _onWheelScroll: function (this: any, e: WheelEvent) {
    if (!this._isWheeling) {
      this._onWheelStart(e);
    }
    this._onWheeling(e);
  },

  _onWheelStart: function (this: any, e: WheelEvent) {
    const map = this._map;
    this._isWheeling = true;
    this._wheelMousePosition = map.mouseEventToContainerPoint(e);
    this._centerPoint = map.getSize().divideBy(2);
    this._startLatLng = map.containerPointToLatLng(this._centerPoint);
    this._wheelMouseLatLng = map.containerPointToLatLng(this._wheelMousePosition);
    this._startZoom = map.getZoom();
    this._moved = false;
    this._zooming = true;

    map._stop();
    if (map._panAnim) {
      map._panAnim.stop();
    }

    this._goalZoom = map.getZoom();
    this._prevCenter = map.getCenter();
    this._prevZoom = map.getZoom();

    this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
  },

  _onWheeling: function (this: any, e: WheelEvent) {
    const map = this._map;

    this._goalZoom = this._goalZoom + (L.DomEvent as any).getWheelDelta(e) * 0.003 * (map.options.smoothSensitivity || 1);
    if (this._goalZoom < map.getMinZoom() || this._goalZoom > map.getMaxZoom()) {
      this._goalZoom = map._limitZoom(this._goalZoom);
    }
    this._wheelMousePosition = this._map.mouseEventToContainerPoint(e);
    this._wheelMouseLatLng = map.containerPointToLatLng(this._wheelMousePosition);

    clearTimeout(this._timeoutId);
    this._timeoutId = setTimeout(this._onWheelEnd.bind(this), 200);

    L.DomEvent.preventDefault(e);
    L.DomEvent.stopPropagation(e);
  },

  _onWheelEnd: function (this: any) {
    this._isWheeling = false;
    cancelAnimationFrame(this._zoomAnimationId);
    if (this._moved) {
      this._map._moveEnd(true);
      this._moved = false;
    }
  },

  _updateWheelZoom: function (this: any) {
    const map = this._map;

    if (!map.getCenter().equals(this._prevCenter) || map.getZoom() !== this._prevZoom) {
      return;
    }

    if (Math.abs(this._goalZoom - map.getZoom()) < 0.005) {
      this._zoom = this._goalZoom;
    } else {
      this._zoom = map.getZoom() + (this._goalZoom - map.getZoom()) * 0.3;
    }
    this._zoom = Math.round(this._zoom * 1000) / 1000;

    const delta = this._wheelMousePosition.subtract(this._centerPoint);
    if (map.options.smoothWheelZoom === 'center' || (delta.x === 0 && delta.y === 0)) {
      this._center = this._startLatLng;
    } else {
      this._center = map.unproject(map.project(this._wheelMouseLatLng, this._zoom).subtract(delta), this._zoom);
    }

    if (!this._moved) {
      map._moveStart(true, false);
      this._moved = true;
    }

    map._move(this._center, this._zoom);
    this._prevCenter = map.getCenter();
    this._prevZoom = map.getZoom();

    this._zoomAnimationId = requestAnimationFrame(this._updateWheelZoom.bind(this));
  }
});

if (!(L.Map as any).prototype._smoothWheelZoomRegistered) {
  (L.Map as any).prototype._smoothWheelZoomRegistered = true;
  (L.Map as any).mergeOptions({
    smoothWheelZoom: true,
    smoothSensitivity: 1
  });
  (L.Map as any).addInitHook('addHandler', 'smoothWheelZoom', SmoothWheelZoom);
}
