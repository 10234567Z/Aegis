"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useBackground } from "./BackgroundContext";

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec2 uResolution;
  uniform vec2 uMouse;
  uniform float uIntensity;
  uniform int uMode;
  varying vec2 vUv;

  float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }

  float noise(vec2 st) {
    vec2 i = floor(st); vec2 f = fract(st);
    float a = random(i); float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0)); float d = random(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm(vec2 st) {
    float value = 0.0; float amp = .5;
    for (int i = 0; i < 5; i++) { value += amp * noise(st); st *= 2.; amp *= .5; }
    return value;
  }

  float grid(vec2 st, float res) {
    vec2 grid = fract(st * res);
    return (step(0.992, grid.x) + step(0.992, grid.y));
  }

  void main() {
    vec2 st = gl_FragCoord.xy / uResolution.xy;
    float aspect = uResolution.x / uResolution.y;
    st.x *= aspect;

    vec2 mousePos = uMouse;
    mousePos.x *= aspect;
    vec2 toMouse = st - mousePos;
    float distMouse = length(toMouse);
    float mouseInteraction = smoothstep(0.4, 0.0, distMouse);

    vec3 finalColor = vec3(0.0);
    vec2 warpSt = st;

    if (uMode == 1) {
      float speed = 0.1;
      vec2 flowDistort = toMouse * mouseInteraction * 1.5;

      vec2 q = vec2(fbm(st + flowDistort + vec2(0.0, uTime * speed)), fbm(st + vec2(5.2, 1.3)));
      vec2 r = vec2(fbm(st + 4.0 * q + vec2(uTime * speed)), fbm(st + 4.0 * q + vec2(5.2)));
      float f = fbm(st + 4.0 * r);

      warpSt += r * 0.1 * uIntensity;
      vec3 psychedelic = mix(uColor, uColor * 1.8, f);
      finalColor += psychedelic * f * f * uIntensity;
    }

    float g = grid(warpSt, 42.0);
    vec3 gridBase = vec3(0.18);
    vec3 gridActive = uColor * 0.8;
    vec3 finalGridCol = mix(gridBase, gridActive, uIntensity * 0.8);
    finalColor += vec3(g) * finalGridCol;

    vec3 baseDark = vec3(0.03, 0.03, 0.04);
    finalColor += baseDark;

    float dist = distance(vUv, vec2(0.5));
    finalColor *= 1.0 - dist * 0.5;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export function BgCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { heroHover, setCanvasReady } = useBackground();
  const targetIntensityRef = useRef(0);
  targetIntensityRef.current = heroHover ? 0.92 : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });

    const uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xec4899) },
      uResolution: { value: new THREE.Vector2() },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uIntensity: { value: 0 },
      uMode: { value: 1 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
    });

    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(plane);

    function resize() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height);
      uniforms.uResolution.value.set(width, height);
    }

    window.addEventListener("resize", resize);
    resize();

    const onMouseMove = (e: MouseEvent) => {
      const x = e.clientX / window.innerWidth;
      const y = 1.0 - e.clientY / window.innerHeight;
      uniforms.uMouse.value.set(x, y);
    };
    window.addEventListener("mousemove", onMouseMove);

    let rafId: number;
    function animate(time: number) {
      rafId = requestAnimationFrame(animate);
      const target = targetIntensityRef.current;
      uniforms.uTime.value = time * 0.001;
      uniforms.uIntensity.value += (target - uniforms.uIntensity.value) * 0.06;
      renderer.render(scene, camera);
    }
    rafId = requestAnimationFrame(animate);

    const showTimer = setTimeout(() => {
      canvas.style.opacity = "1";
      setCanvasReady(true);
    }, 150);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMouseMove);
      clearTimeout(showTimer);
      renderer.dispose();
      material.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="bg-canvas"
      role="presentation"
      aria-hidden
      title="Dynamic background animation"
      className="bg-canvas"
    />
  );
}
