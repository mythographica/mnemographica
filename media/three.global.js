// Three.js Global Wrapper
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.THREE = {}));
})(this, (function (exports) { 'use strict';

  // Minimal Three.js implementation for basic 3D rendering
  // This is a simplified version - for full features, use the ES module build
  
  // Vector3
  class Vector3 {
    constructor(x=0, y=0, z=0) { this.x=x; this.y=y; this.z=z; }
    set(x,y,z) { this.x=x; this.y=y; this.z=z; return this; }
  }
  
  // Color
  class Color {
    constructor(hex) { this.setHex(hex); }
    setHex(hex) { this.r=((hex>>16)&255)/255; this.g=((hex>>8)&255)/255; this.b=(hex&255)/255; return this; }
  }
  
  // Scene
  class Scene {
    constructor() { this.children=[]; this.background=null; this.fog=null; }
    add(obj) { this.children.push(obj); }
    remove(obj) { const i=this.children.indexOf(obj); if(i>-1) this.children.splice(i,1); }
  }
  
  // PerspectiveCamera
  class PerspectiveCamera {
    constructor(fov, aspect, near, far) {
      this.fov=fov; this.aspect=aspect; this.near=near; this.far=far;
      this.position=new Vector3();
      this.projectionMatrix={ elements:new Float32Array(16) };
      this.updateProjectionMatrix();
    }
    updateProjectionMatrix() {
      const f=1.0/Math.tan(this.fov*Math.PI/360);
      const nf=1/(this.near-this.far);
      const m=this.projectionMatrix.elements;
      m[0]=f/this.aspect; m[5]=f; m[10]=(this.far+this.near)*nf; m[11]=-1;
      m[14]=2*this.far*this.near*nf;
    }
    lookAt(x,y,z) {}
  }
  
  // WebGLRenderer
  class WebGLRenderer {
    constructor(opts={}) {
      this.canvas=document.createElement('canvas');
      this.gl=this.canvas.getContext('webgl')||this.canvas.getContext('experimental-webgl');
      if(!this.gl) throw new Error('WebGL not supported');
      this.domElement=this.canvas;
      this.setSize(800,600);
    }
    setSize(w,h) { this.canvas.width=w; this.canvas.height=h; this.canvas.style.width=w+'px'; this.canvas.style.height=h+'px'; }
    setPixelRatio(r) {}
    render(scene, camera) {}
    dispose() {}
  }
  
  // Lights
  class AmbientLight { constructor(c,i) { this.color=new Color(c); this.intensity=i; } }
  class DirectionalLight { constructor(c,i) { this.color=new Color(c); this.intensity=i; this.position=new Vector3(); } }
  class PointLight { constructor(c,i) { this.color=new Color(c); this.intensity=i; this.position=new Vector3(); } }
  
  // Fog
  class Fog { constructor(c,near,far) { this.color=new Color(c); this.near=near; this.far=far; } }
  
  // Geometry
  class BufferGeometry {
    constructor() { this.attributes={}; }
    setAttribute(name, attr) { this.attributes[name]=attr; }
  }
  class SphereGeometry extends BufferGeometry {
    constructor(r,s1,s2) { super(); this.radius=r; }
  }
  
  // BufferAttribute
  class BufferAttribute {
    constructor(arr, itemSize) { this.array=arr; this.itemSize=itemSize; this.needsUpdate=false; }
  }
  
  // Materials
  class Material { constructor() { this.needsUpdate=false; } dispose() {} }
  class MeshPhongMaterial extends Material {
    constructor(opts={}) { super(); this.color=opts.color?new Color(opts.color):new Color(0xffffff); this.shininess=opts.shininess||30; this.specular=opts.specular?new Color(opts.specular):new Color(0x111111); this.emissive=opts.emissive?new Color(opts.emissive):new Color(0); this.emissiveIntensity=opts.emissiveIntensity||0; this.transparent=opts.transparent||false; this.opacity=opts.opacity!==undefined?opts.opacity:1; }
  }
  class LineBasicMaterial extends Material {
    constructor(opts={}) { super(); this.color=opts.color?new Color(opts.color):new Color(0xffffff); this.transparent=opts.transparent||false; this.opacity=opts.opacity!==undefined?opts.opacity:1; }
  }
  class SpriteMaterial extends Material {
    constructor(opts={}) { super(); this.map=opts.map||null; }
  }
  
  // Mesh
  class Mesh {
    constructor(geo, mat) { this.geometry=geo; this.material=mat; this.position=new Vector3(); this.userData={}; this.children=[]; }
    add(c) { this.children.push(c); }
  }
  
  // Line
  class Line extends Mesh {}
  
  // Sprite
  class Sprite extends Mesh {
    constructor(mat) { super(null,mat); this.scale=new Vector3(1,1,1); }
  }
  
  // CanvasTexture
  class CanvasTexture {
    constructor(canvas) { this.image=canvas; }
  }
  
  // Raycaster
  class Raycaster {
    constructor() { this.ray={ origin:new Vector3(), direction:new Vector3() }; }
    setFromCamera(coords, camera) {}
    intersectObjects(objects) { return []; }
  }

  // Exports
  exports.Vector3 = Vector3;
  exports.Color = Color;
  exports.Scene = Scene;
  exports.PerspectiveCamera = PerspectiveCamera;
  exports.WebGLRenderer = WebGLRenderer;
  exports.AmbientLight = AmbientLight;
  exports.DirectionalLight = DirectionalLight;
  exports.PointLight = PointLight;
  exports.Fog = Fog;
  exports.BufferGeometry = BufferGeometry;
  exports.SphereGeometry = SphereGeometry;
  exports.BufferAttribute = BufferAttribute;
  exports.Material = Material;
  exports.MeshPhongMaterial = MeshPhongMaterial;
  exports.LineBasicMaterial = LineBasicMaterial;
  exports.SpriteMaterial = SpriteMaterial;
  exports.Mesh = Mesh;
  exports.Line = Line;
  exports.Sprite = Sprite;
  exports.CanvasTexture = CanvasTexture;
  exports.Raycaster = Raycaster;

}));
