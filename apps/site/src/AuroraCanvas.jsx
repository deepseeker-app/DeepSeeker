import { useEffect, useRef } from "react";

const COLORS = ["#ffc400", "#ff6b35", "#f43f8f", "#7c3aed", "#00b8f0"];

export function AuroraCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d", { alpha: true });
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let animationFrame = 0;
    let pointerX = 0.5;
    let pointerY = 0.35;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = Math.min(window.innerHeight * 1.35, 1100);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      context.save();
      context.globalAlpha = 0.13;
      context.strokeStyle = "#8aa0b5";
      context.lineWidth = 0.5;
      for (let x = 0; x < width; x += 54) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      for (let y = 0; y < height; y += 54) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
      context.restore();

      const beamY = width < 700 ? 482 : Math.min(height * 0.45, 382);
      const startX = width < 700 ? width * 0.02 : width * 0.08;
      const endX = width * 0.94;
      for (let pass = 0; pass < 5; pass += 1) {
        context.save();
        context.globalCompositeOperation = "screen";
        context.globalAlpha = pass === 0 ? 0.82 : 0.16;
        context.lineWidth = pass === 0 ? 1.2 : pass * 4;
        context.shadowBlur = pass * 10;
        context.shadowColor = COLORS[(pass + 3) % COLORS.length];
        const gradient = context.createLinearGradient(startX, beamY, endX, beamY);
        COLORS.forEach((color, index) => gradient.addColorStop(index / (COLORS.length - 1), color));
        context.strokeStyle = gradient;
        context.beginPath();
        context.moveTo(startX, beamY);
        context.bezierCurveTo(width * 0.34, beamY - Math.sin(frame * 0.012) * 3, width * 0.66, beamY + Math.cos(frame * 0.01) * 3, endX, beamY);
        context.stroke();
        context.restore();
      }

      for (let i = 0; i < 34; i += 1) {
        const seed = i * 91.37;
        const x = ((Math.sin(seed) + 1) / 2) * width + (pointerX - 0.5) * (i % 5) * 5;
        const baseY = ((Math.cos(seed * 0.72) + 1) / 2) * height * 0.72;
        const y = baseY + Math.sin(frame * 0.008 + seed) * (6 + (i % 4) * 3) + (pointerY - 0.5) * 10;
        const radius = 0.7 + (i % 3) * 0.55;
        context.save();
        context.globalAlpha = 0.16 + (i % 5) * 0.04;
        context.fillStyle = COLORS[i % COLORS.length];
        context.shadowBlur = 9;
        context.shadowColor = COLORS[i % COLORS.length];
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }

      if (!reduceMotion) {
        frame += 1;
        animationFrame = requestAnimationFrame(draw);
      }
    };

    const onPointerMove = (event) => {
      pointerX = event.clientX / Math.max(window.innerWidth, 1);
      pointerY = event.clientY / Math.max(window.innerHeight, 1);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="aurora-canvas" aria-hidden="true" />;
}
