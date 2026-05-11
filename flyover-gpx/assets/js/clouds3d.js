/**
 * Flyover GPX — 3D Cloud Layer (clouds3d.js)
 *
 * Implements a MapLibre GL CustomLayerInterface that renders semi-volumetric
 * billboard clouds using three.js. Shares the map's WebGL context so there is no
 * extra canvas and no additional GPU memory for a framebuffer.
 *
 * Architecture:
 *   - MapLibre calls render() every frame via the custom layer mechanism.
 *   - A single THREE.InstancedMesh of a 1×1 PlaneGeometry represents all clouds.
 *   - Each vertex shader instance rotates the quad to face the camera (billboard).
 *   - The fragment shader applies 2D FBM noise to produce puffy, semi-transparent edges.
 *   - Cloud density / opacity is driven by cloud_cover_pct via a callback injected
 *     by front.js so the layer integrates with the existing weather pipeline.
 *   - Sun direction is passed as a uniform for warm/cool tinting.
 *   - A slow time offset creates gentle drift animation (can be disabled via quality preset).
 *
 * Quality presets:
 *   low    — 32 instances, 2 FBM octaves, no sun shading, no drift.
 *   medium — 96 instances, 2 FBM octaves, sun shading, drift enabled. (default)
 *   high   — 192 instances, 3 FBM octaves, sun shading, drift enabled.
 *
 * Integration contract:
 *   window.FGPXClouds3D.create(map, options) → CustomLayerInterface object
 *
 *   options:
 *     quality       {string}   'low'|'medium'|'high'       (default 'medium')
 *     weatherPoints {Array}    [{lng, lat, cloudCoverPct}]  cluster seed positions
 *     getCloudCover {function} () → number 0-100            real-time cover query
 *     getSunAzimuth {function} () → number degrees          sun direction (optional)
 *
 * Teardown:
 *   Call layer.dispose() or map.removeLayer(layer.id) — three.js resources are freed
 *   in the CustomLayerInterface's onRemove() callback.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* GLSL shaders                                                         */
  /* ------------------------------------------------------------------ */

  var VERT_SHADER = /* glsl */[
    'precision mediump float;',
    '',
    'attribute vec3 position;',         // quad local [-0.5..0.5]
    'attribute vec2 uv;',
    'attribute vec3 instanceOffset;',   // world-space Mercator XYZ offsets per instance
    'attribute float instanceScale;',   // per-instance size (m in Mercator units)
    'attribute float instanceOpacity;', // per-instance base opacity',
    '',
    'varying vec2 vUv;',
    'varying float vOpacity;',
    '',
    'uniform mat4 uProjMatrix;',   // MapLibre projection matrix (view * proj)
    'uniform vec3 uCameraRight;',  // camera right vector (world space)
    'uniform vec3 uCameraUp;',     // camera up vector (world space)
    '',
    'void main() {',
    '  // Billboard: rotate quad to face camera',
    '  vec3 worldPos = instanceOffset',
    '    + uCameraRight * position.x * instanceScale',
    '    + uCameraUp    * position.y * instanceScale;',
    '  gl_Position = uProjMatrix * vec4(worldPos, 1.0);',
    '  vUv      = uv;',
    '  vOpacity = instanceOpacity;',
    '}',
  ].join('\n');

  /* Fragment shader: 2D FBM for soft puffy edges.
   * Compiled with #define OCTAVES so the quality preset controls the loop count. */
  function buildFragShader(octaves) {
    return [
      '#define OCTAVES ' + octaves,
      'precision mediump float;',
      '',
      'varying vec2 vUv;',
      'varying float vOpacity;',
      '',
      'uniform float uTime;',
      'uniform float uGlobalOpacity;', // 0-1 from cloud_cover_pct
      'uniform float uCoverNorm;',     // cloud_cover_pct normalized to 0-1
      'uniform vec3  uSunDir;',        // normalised sun direction
      'uniform bool  uSunShading;',
      '',
      '// Hash / noise helpers',
      'vec2 hash22(vec2 p) {',
      '  p = vec2(dot(p, vec2(127.1, 311.7)),',
      '           dot(p, vec2(269.5, 183.3)));',
      '  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);',
      '}',
      '',
      'float noise(vec2 p) {',
      '  vec2 i = floor(p);',
      '  vec2 f = fract(p);',
      '  vec2 u = f * f * (3.0 - 2.0 * f);',
      '  return mix(',
      '    mix(dot(hash22(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),',
      '        dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),',
      '    mix(dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),',
      '        dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),',
      '    u.y);',
      '}',
      '',
      'float fbm(vec2 p) {',
      '  float v = 0.0, a = 0.5;',
      '  for (int i = 0; i < OCTAVES; i++) {',
      '    v += a * noise(p);',
      '    p *= 2.0;',
      '    a *= 0.5;',
      '  }',
      '  return v;',
      '}',
      '',
      'void main() {',
      '  vec2 centered = vUv - 0.5;',               // center quad at (0,0)
      '  float dist = length(centered);',
      '  // soft circular mask (discard corners of quad)',
      '  float mask = 1.0 - smoothstep(0.18, 0.56, dist);',
      '  if (mask < 0.001) discard;',
      '',
      '  // FBM noise for puffy silhouette',
      '  vec2 noiseUv = vUv * 2.4 + vec2(uTime * 0.08, uTime * 0.05);',
      '  float density = fbm(noiseUv) * 0.5 + 0.5;', // map [-1,1] → [0,1]
      '  float cover = clamp(uCoverNorm, 0.0, 1.0);',
      '  float denseEdge = mix(0.60, 0.36, cover);',
      '  float softEdge = mix(0.28, 0.46, cover);',
      '  float fluffy = smoothstep(denseEdge, denseEdge + softEdge, density);',
      '  float alpha = fluffy * mask * vOpacity * uGlobalOpacity;',
      '',
      '  // Sun shading: top-lit warm, bottom cool',
      '  vec3 baseColor = vec3(1.0, 1.0, 1.0);',
      '  if (uSunShading) {',
      '    float sunLight = clamp(dot(vec3(0.0, 1.0, 0.0), uSunDir) * 0.5 + 0.5, 0.0, 1.0);',
      '    baseColor = mix(vec3(0.86, 0.90, 0.95), vec3(1.0, 0.99, 0.97), sunLight);',
      '  }',
      '  baseColor = mix(baseColor, vec3(0.99, 0.995, 1.0), cover * 0.45);',
      '',
      '  gl_FragColor = vec4(baseColor, alpha);',
      '}',
    ].join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* Quality preset table                                                 */
  /* ------------------------------------------------------------------ */

  var QUALITY_PRESETS = {
    low:    { instances: 32,  octaves: 2, sunShading: false, drift: false },
    medium: { instances: 96,  octaves: 2, sunShading: true,  drift: true  },
    high:   { instances: 192, octaves: 3, sunShading: true,  drift: true  },
  };

  /* ------------------------------------------------------------------ */
  /* Random helpers (deterministic seed)                                  */
  /* ------------------------------------------------------------------ */

  function seededRand(seed) {
    var x = Math.sin(seed + 1) * 43758.5453123;
    return x - Math.floor(x);
  }

  /* ------------------------------------------------------------------ */
  /* Layer factory                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * @param {maplibregl.Map} map
   * @param {object} opts
   * @param {string}   [opts.quality='medium']
   * @param {Array}    [opts.weatherPoints=[]]   [{lng,lat,cloudCoverPct}]
   * @param {function} [opts.getCloudCover]      () → 0-100
   * @param {function} [opts.getSunAzimuth]      () → degrees (0=N)
   * @returns {object} CustomLayerInterface
   */
  function create(map, opts) {
    opts = opts || {};
    var qualityKey = String(opts.quality || 'medium').toLowerCase();
    if (!QUALITY_PRESETS[qualityKey]) { qualityKey = 'medium'; }
    var preset = QUALITY_PRESETS[qualityKey];
    var weatherPoints = Array.isArray(opts.weatherPoints) ? opts.weatherPoints : [];
    var getCloudCover = typeof opts.getCloudCover === 'function' ? opts.getCloudCover : function () { return 0; };
    var getSunAzimuth = typeof opts.getSunAzimuth === 'function' ? opts.getSunAzimuth : function () { return 0; };
    var intensityCap  = (typeof opts.intensity === 'number' && isFinite(opts.intensity)) ? Math.max(0.1, Math.min(1.0, opts.intensity)) : 0.7;

    /* ---- internal state ---- */
    var THREE = window.THREE;
    if (!THREE) {
      // three.js not loaded — return a no-op layer so front.js doesn't crash
      return { id: 'fgpx-clouds-3d', type: 'custom', renderingMode: '3d',
               onAdd: function () {}, render: function () {}, onRemove: function () {} };
    }

    var renderer = null;
    var scene    = null;
    var camera   = null;
    var mesh     = null;
    var material = null;
    var mapRef   = null; // stored in onAdd for zoom guard

    /* ---- attribute arrays ---- */
    var instanceOffsets  = null;
    var instanceScales   = null;
    var instanceOpacities = null;

    // Lerp state for smooth opacity transitions
    var targetGlobalOpacity = 0;
    var currentGlobalOpacity = 0;

    // Animation time
    var startTime = 0;

    /* ---------------------------------------------------------------- */
    /* Build instance data from weather feature points                   */
    /* ---------------------------------------------------------------- */
    var offsetArr, scaleArr, opacityArr;

    function buildInstances(MercatorCoordinate) {
      var N = preset.instances;
      offsetArr   = new Float32Array(N * 3);
      scaleArr    = new Float32Array(N);
      opacityArr  = new Float32Array(N);

      // If we have weather points, seed around them. Else scatter along track.
      var seeds = weatherPoints.length > 0 ? weatherPoints :
        [{ lng: 0, lat: 0, cloudCoverPct: 100 }];

      for (var i = 0; i < N; i++) {
        var seed  = seeds[i % seeds.length];
        var rng   = seededRand(i * 7.3 + 13.1);
        var rng2  = seededRand(i * 3.7 + 41.9);
        var rng3  = seededRand(i * 11.1 + 2.3);

        // Keep clusters compact so clouds read as fluffy masses, not wide nebula.
        var lngOffset = (rng  - 0.5) * 0.04;
        var latOffset = (rng2 - 0.5) * 0.04;
        var altM = 1700 + rng3 * 1500; // 1700 – 3200 m

        var mc = MercatorCoordinate.fromLngLat(
          { lng: seed.lng + lngOffset, lat: seed.lat + latOffset },
          altM
        );
        offsetArr[i * 3    ] = mc.x;
        offsetArr[i * 3 + 1] = mc.y;
        offsetArr[i * 3 + 2] = mc.z;

        // Scale: 900 – 2300 m keeps cloud bodies larger and less speckled.
        var meterScale = 900 + seededRand(i * 5.5 + 7.7) * 1400;
        // MercatorCoordinate.meterInMercatorCoordinateUnits() at the seed location
        var meterInMerc = mc.meterInMercatorCoordinateUnits ? mc.meterInMercatorCoordinateUnits() :
          (1 / (Math.cos(seed.lat * Math.PI / 180) * 20037508.34 * 2));
        scaleArr[i] = meterScale * meterInMerc;

        // Narrow opacity spread for more consistent fluffy coverage.
        opacityArr[i] = 0.72 + seededRand(i * 9.1 + 3.3) * 0.22;
      }
    }

    /* ---------------------------------------------------------------- */
    /* CustomLayerInterface                                              */
    /* ---------------------------------------------------------------- */

    var layer = {
      id: 'fgpx-clouds-3d',
      type: 'custom',
      renderingMode: '3d',

      onAdd: function (m, gl) {
        startTime = performance.now();
        mapRef = m;

        // Build per-instance position data using MapLibre's Mercator helpers
        var MercatorCoordinate = window.maplibregl &&
          window.maplibregl.MercatorCoordinate;
        if (!MercatorCoordinate) {
          // Fallback: disable layer gracefully if projection API missing
          return;
        }
        buildInstances(MercatorCoordinate);

        /* three.js renderer shares the map's WebGL context — do NOT call
         * setPixelRatio or setSize: MapLibre owns the canvas dimensions. */
        renderer = new THREE.WebGLRenderer({
          canvas: m.getCanvas(),
          context: gl,
          antialias: false,
        });
        renderer.autoClear = false;

        scene  = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(); // matrix replaced each frame

        /* Geometry: unit quad */
        var geo = new THREE.BufferGeometry();
        var verts = new Float32Array([
          -0.5, -0.5, 0,
           0.5, -0.5, 0,
           0.5,  0.5, 0,
          -0.5,  0.5, 0,
        ]);
        var uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
        var idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
        geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        geo.setAttribute('uv',       new THREE.BufferAttribute(uvs,   2));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));

        /* Per-instance attributes */
        var N = preset.instances;
        // Mark geometry as instanced so three.js calls gl.drawElementsInstanced
        geo.isInstancedBufferGeometry = true;
        geo.instanceCount = N;
        var offAttr   = new THREE.InstancedBufferAttribute(offsetArr,   3);
        var scaleAttr = new THREE.InstancedBufferAttribute(scaleArr,    1);
        var opAttr    = new THREE.InstancedBufferAttribute(opacityArr,  1);
        geo.setAttribute('instanceOffset',  offAttr);
        geo.setAttribute('instanceScale',   scaleAttr);
        geo.setAttribute('instanceOpacity', opAttr);

        /* Custom shader material */
        material = new THREE.RawShaderMaterial({
          vertexShader:   VERT_SHADER,
          fragmentShader: buildFragShader(preset.octaves),
          uniforms: {
            uProjMatrix:      { value: new THREE.Matrix4() },
            uCameraRight:     { value: new THREE.Vector3() },
            uCameraUp:        { value: new THREE.Vector3() },
            uTime:            { value: 0.0 },
            uGlobalOpacity:   { value: 0.0 },
            uCoverNorm:       { value: 0.0 },
            uSunDir:          { value: new THREE.Vector3(0, 1, 0) },
            uSunShading:      { value: preset.sunShading },
          },
          transparent: true,
          depthWrite:  false,
          blending:    THREE.NormalBlending,
          side:        THREE.DoubleSide,
        });

        mesh = new THREE.Mesh(geo, material);
        mesh.frustumCulled = false; // we position in Mercator space, bypass sphere check
        scene.add(mesh);
      },

      render: function (gl, args) {
        if (!renderer || !scene || !camera || !mesh) { return; }

        /* ----- visibility check: respect weatherVisible toggle ----- */
        var cover = getCloudCover();
        var coverNorm = (cover >= 0) ? Math.min(1.0, cover / 100) : 0;
        targetGlobalOpacity = Math.min(intensityCap, Math.pow(coverNorm, 0.9) * intensityCap);
        // Lerp for smooth fade (≈0.05 per frame at 60 fps ≈ ~0.3 s)
        currentGlobalOpacity += (targetGlobalOpacity - currentGlobalOpacity) * 0.05;

        // Fade out smoothly when zooming out so clouds do not dominate wide views.
        var zoomFade = 1.0;
        if (mapRef && typeof mapRef.getZoom === 'function') {
          var zoom = mapRef.getZoom();
          if (zoom <= 6) {
            zoomFade = 0;
          } else if (zoom < 8) {
            zoomFade = (zoom - 6) / 2;
          }
        }

        var effectiveOpacity = currentGlobalOpacity * zoomFade;
        if (effectiveOpacity < 0.005) {
          return; // skip draw when fully invisible
        }

        /* ----- build projection matrix from MapLibre args ----- */
        var projData = args.defaultProjectionData;
        var mat = projData && projData.mainMatrix;
        if (!mat) { return; }

        // MapLibre passes a flat 16-element Float64Array in column-major order.
        // THREE.Matrix4.fromArray() reads column-major directly — do NOT use
        // m4.set() which expects row-major input and would transpose the matrix.
        var m4 = material.uniforms.uProjMatrix.value;
        m4.fromArray(mat);

        /* ----- extract camera right / up vectors (world space) ----- */
        // mainMatrix = VP (column-major). Columns 0 and 1 of the VIEW matrix give
        // the camera right and up directions in Mercator world space. We approximate
        // by reading the first two columns of VP (valid when projection is narrow FOV,
        // which holds at zoom ≥ 7). Column i of a column-major matrix is at mat[i*4].
        // Column 0 of VP = (mat[0], mat[1], mat[2]) → camera right in Mercator.
        // Column 1 of VP = (mat[4], mat[5], mat[6]) → camera up in Mercator.
        material.uniforms.uCameraRight.value.set(mat[0], mat[1], mat[2]).normalize();
        material.uniforms.uCameraUp.value.set(mat[4], mat[5], mat[6]).normalize();

        /* ----- time ----- */
        if (preset.drift) {
          material.uniforms.uTime.value = (performance.now() - startTime) * 0.00035;
        }

        /* ----- sun direction (simplified: azimuth → horizontal unit vector) ----- */
        if (preset.sunShading) {
          var azRad = (getSunAzimuth() * Math.PI) / 180;
          material.uniforms.uSunDir.value.set(
            Math.sin(azRad), 0.6, Math.cos(azRad)
          ).normalize();
        }

        material.uniforms.uCoverNorm.value = coverNorm;
        material.uniforms.uGlobalOpacity.value = effectiveOpacity;

        /* ----- render ----- */
        renderer.resetState();
        renderer.render(scene, camera);
      },

      onRemove: function () {
        if (mesh)     { mesh.geometry.dispose(); }
        if (material) { material.dispose(); }
        if (renderer) { renderer.dispose(); }
        mesh = null; material = null; renderer = null; scene = null; camera = null;
      },
    };

    return layer;
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                           */
  /* ------------------------------------------------------------------ */

  window.FGPXClouds3D = { create: create };

})();
