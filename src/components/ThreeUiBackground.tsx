import { useEffect, useRef } from "react";

/**
 * ThreeUI-inspired interactive ambient canvas background.
 * Renders drifting constellation nodes, radiant filament connections,
 * and responds softly to cursor position for tactile depth.
 * Zero external dependencies; 60fps native Canvas 2D.
 */
export function ThreeUiBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const onResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", onResize);

    // Particle nodes
    const NODE_COUNT = Math.min(48, Math.floor((width * height) / 28000));
    const nodes: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      color: string;
    }[] = [];

    const palette = [
      "rgba(99, 102, 241, ", // Indigo
      "rgba(56, 189, 248, ", // Sky/Cyan
      "rgba(139, 92, 246, ", // Violet
      "rgba(16, 185, 129, ", // Emerald
    ];

    for (let i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.45,
        vy: (Math.random() - 0.5) * 0.45,
        radius: 1.2 + Math.random() * 2,
        color: palette[Math.floor(Math.random() * palette.length)]!,
      });
    }

    let mouseX = width / 2;
    let mouseY = height / 3;

    const onMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };
    window.addEventListener("mousemove", onMouseMove);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Subtle ambient top-center glow (ThreeUI hallmark)
      const grad = ctx.createRadialGradient(
        mouseX,
        mouseY * 0.8,
        10,
        width / 2,
        height / 3,
        Math.max(width, height) * 0.65,
      );
      grad.addColorStop(0, "rgba(99, 102, 241, 0.08)");
      grad.addColorStop(0.35, "rgba(56, 189, 248, 0.04)");
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Connect filaments
      const maxDist = 130;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]!;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < maxDist) {
            const alpha = (1 - dist / maxDist) * 0.16;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(148, 163, 184, ${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }

        // Draw node
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.radius, 0, Math.PI * 2);
        ctx.fillStyle = a.color + "0.65)";
        ctx.shadowColor = a.color + "0.8)";
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Move node
        a.x += a.vx;
        a.y += a.vy;

        // Soft bounce at borders
        if (a.x < 0) {
          a.x = 0;
          a.vx *= -1;
        } else if (a.x > width) {
          a.x = width;
          a.vx *= -1;
        }
        if (a.y < 0) {
          a.y = 0;
          a.vy *= -1;
        } else if (a.y > height) {
          a.y = height;
          a.vy *= -1;
        }
      }

      animId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full opacity-60"
      aria-hidden="true"
    />
  );
}
