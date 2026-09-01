"use client";

import React, { memo, useMemo } from "react";

interface FloatingParticlesProps extends React.HTMLAttributes<HTMLDivElement> {
  count?: number;
  color?: string;
  minSize?: number;
  maxSize?: number;
  speed?: number;
}

/**
 * FloatingParticles — a gentle ambient particle field.
 *
 * Quill's distinctive background effect: softly drifting dots that create
 * depth without the harsh flicker of a grid. Each particle has its own
 * orbit radius, speed, and phase offset so the motion feels organic.
 */
export const FloatingParticles = memo(
  ({
    className = "",
    count = 30,
    color = "currentColor",
    minSize = 2,
    maxSize = 5,
    speed = 1,
  }: FloatingParticlesProps) => {
    // Generate stable particle parameters once.
    const particles = useMemo(() => {
      return Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: minSize + Math.random() * (maxSize - minSize),
        duration: (15 + Math.random() * 25) / speed,
        delay: Math.random() * -30,
        opacity: 0.15 + Math.random() * 0.35,
        driftX: (Math.random() - 0.5) * 8,
        driftY: (Math.random() - 0.5) * 8,
      }));
    }, [count, minSize, maxSize, speed]);

    return (
      <div className={`pointer-events-none absolute inset-0 ${className}`} aria-hidden="true">
        {particles.map((p) => (
          <div
            key={p.id}
            className="absolute rounded-full"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              backgroundColor: color,
              opacity: p.opacity,
              animation: `particle-drift ${p.duration}s ease-in-out ${p.delay}s infinite alternate`,
              ["--drift-x" as string]: `${p.driftX}px`,
              ["--drift-y" as string]: `${p.driftY}px`,
            }}
          />
        ))}
      </div>
    );
  },
);

FloatingParticles.displayName = "FloatingParticles";
