// @ts-check
// SPDX-License-Identifier: MPL-2.0
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
// If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The UI mockup's patchTerrain in metres, for MeshLambertMaterial.onBeforeCompile:
// land cover (forest canopy, field parcels, matte water with a lighter shore), engraved contours every
// 20 m / 100 m that fade out as they crowd, a plaster grain, and strata on the slab walls
// (material.defines.STRATA). The mockup worked in 100 m units; `u` below is that unit, so its noise
// scales carry over unchanged.

const HEAD = /* glsl */ `#include <common>
varying vec3 vW;
uniform float uVex;
uniform vec3 uSea, uShore;
uniform sampler2D uLand;                  // land cover as weights: r forest, g farmland, b water; mipmapped
uniform float uLandOn;                    // 0 until (or unless) it loaded: plain plaster
uniform vec4 uLandGrid;                   // x0, z0, dx, dz of the DEM samples (one texel each), metres
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vn2(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x),u.y);}
// a line every I metres of height, ~1 px wide, gone once they are closer than ~4 px
float cline(float h,float I,float fw){float d=abs(fract(h/I-.5)-.5)*I/fw;
  return (1.-smoothstep(.2,1.,d))*(1.-smoothstep(I/7.,I/3.5,fw));}`;

const BODY = /* glsl */ `#include <color_fragment>
float hm=vW.y/uVex;                       // metres AMSL: the terrain group is scaled by uVex
float fw=max(fwidth(hm),1e-4);
float cl=(.09*cline(hm,20.,fw)+.2*cline(hm,100.,fw))*smoothstep(.002,.01,fw);  // none on flat water
vec2 u=vW.xz*.01;
float px=max(fwidth(u.x),fwidth(u.y));    // units per pixel
#ifndef STRATA
vec3 lc=uLandOn>.5?texture(uLand,((vW.xz-uLandGrid.xy)/uLandGrid.zw+.5)/vec2(textureSize(uLand,0))).rgb:vec3(0.);
float dry=max(1.-lc.z,1e-3);               // shares of the land part: forest and fields run up to the water
float vFld=smoothstep(.35,.65,lc.y/dry),vFor=smoothstep(.35,.65,lc.x/dry);
if(vFld>.02){                             // farmland: a green tint, parcels with hedges up close
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.56,.66,.33),.3*vFld);
  float an=(vn2(u*.025)-.5)*1.6;mat2 R=mat2(cos(an),-sin(an),sin(an),cos(an));
  vec2 q=(R*u)*vec2(1./1.7,1./.9);vec2 id=floor(q),f=fract(q);
  float cellPx=.9/px;float tf=smoothstep(3.,12.,cellPx);
  float tone=h21(id)-.5;float sg=step(.72,h21(id+7.));
  vec2 e=min(f,1.-f)/max(fwidth(q),vec2(1e-5));float ed=min(e.x,e.y);
  float hedge=(1.-smoothstep(.4,1.4,ed))*smoothstep(10.,26.,cellPx);
  diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.84,.97,.74),sg*.55*tf*vFld);
  diffuseColor.rgb*=1.+tone*.11*tf*vFld;
  diffuseColor.rgb*=1.-.12*hedge*vFld;
}
if(vFor>.02){                             // forest: an even green far out, tree crowns up close
  vec3 tree=vec3(.24,.44,.18);
  vec2 q=u/.11;vec2 id=floor(q);vec2 f=fract(q)-.5;vec2 o=(vec2(h21(id),h21(id+3.1))-.5)*.35;
  float r=.38+.12*h21(id+9.);vec2 dv=f-o;float d=length(dv)/r;
  float cpx=.11/px;float k1=smoothstep(2.5,6.,cpx);
  float canopy=1.-smoothstep(.8,1.,d);float lit=dot(dv/r,vec2(.55,.75));
  vec3 c1=mix(diffuseColor.rgb*.86,tree*(1.-.22*lit),canopy);
  float mot=(vn2(u/2.5)-.5)*.14*smoothstep(2.,6.,2.5/px);
  vec3 avg=mix(diffuseColor.rgb,tree,.55)*(1.+mot);
  diffuseColor.rgb=mix(diffuseColor.rgb,mix(avg,c1,k1),vFor);
}
// water: the sea (DEM < 1 m, antialiased) and mapped water, lighter along the shore
float water=max(1.-smoothstep(-.5,.5,(hm-.75)/fw),smoothstep(.4,.6,lc.z));
diffuseColor.rgb=mix(diffuseColor.rgb,uLandOn>.5?mix(uShore,uSea,smoothstep(.6,.95,lc.z)):uSea,water);
cl*=1.-water;
#endif
float gr=(vn2(u*.35)-.5)*.05+(vn2(u*2.2)-.5)*.05*(1.-smoothstep(.06,.25,px*2.2))
  +(vn2(u*11.)-.5)*.04*(1.-smoothstep(.06,.25,px*11.));
diffuseColor.rgb*=(1.+gr)*(1.-cl);
#ifdef STRATA
// the slab walls: 200 m layers of alternating tone, a fine line between them
float sd=abs(fract(hm/200.-.5)-.5)*200./fw;  // px to the nearest layer line
diffuseColor.rgb*=(1.-.05*step(.5,fract(hm/400.)))*(1.-.2*(1.-smoothstep(.3,1.,sd))*smoothstep(2.,4.,200./fw));
#endif`;

/**
 * Patch a MeshLambertMaterial's shader; the uniforms are shared by every terrain material.
 * @param {Record<string, {value: any}>} uniforms uVex, uSea, uShore, uLand, uLandOn, uLandGrid
 * @returns {(shader: {uniforms: object, vertexShader: string, fragmentShader: string}) => void}
 */
export function patchTerrain(uniforms) {
  return (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vW;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvW=(modelMatrix*vec4(transformed,1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", HEAD).replace("#include <color_fragment>", BODY);
  };
}
