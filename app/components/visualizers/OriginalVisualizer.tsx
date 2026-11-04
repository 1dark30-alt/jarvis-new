'use client';

import { useRef, useEffect } from 'react';

interface Props {
  fftData: number[];
  status: 'idle' | 'listening' | 'active' | 'error';
}

export function OriginalVisualizer({ fftData, status }: Props) {
  // Layer refs — DOM transforms applied directly (no React re-render per frame)
  const tikRef    = useRef<HTMLDivElement>(null);
  const outerRef  = useRef<HTMLDivElement>(null);
  const innerRef  = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);
  const swingRef  = useRef<HTMLDivElement>(null);

  const fftRef    = useRef(fftData);
  const statusRef = useRef(status);
  const rafRef    = useRef<number>(0);

  useEffect(() => { fftRef.current = fftData; }, [fftData]);
  useEffect(() => { statusRef.current = status; }, [status]);

  useEffect(() => {
    // All angles in degrees; velocities in deg/s
    const st = {
      tikAngle:    0,
      outerAngle:  0,
      innerAngle:  0,
      // Yellow arc: spring-damped pendulum
      yellowAngle: -30,
      yellowVel:   0,
      // Swing dial: separate pendulum with ratchet impulses
      swingAngle:  -25,
      swingVel:    0,
      swingNextTick: 0,
      lastTime:    0,
    };

    // Spring-damper helper (degrees, K in 1/s², D in 1/s)
    const spring = (
      pos: number, vel: number, target: number,
      K: number, D: number, dt: number
    ): [number, number] => {
      const accel = K * (target - pos) - D * vel;
      const nVel  = vel  + accel * dt;
      const nPos  = pos  + nVel  * dt;
      return [nPos, nVel];
    };

    const animate = (now: number) => {
      rafRef.current = requestAnimationFrame(animate);

      const dt = Math.min((now - (st.lastTime || now)) * 0.001, 0.05);
      st.lastTime = now;
      const t = now * 0.001;

      const stat     = statusRef.current;
      const isActive = stat === 'active';
      const isListen = stat === 'listening';

      const fft = fftRef.current;
      let energy = 0;
      for (let i = 0; i < fft.length; i++) energy += fft[i];
      energy = fft.length > 0 ? energy / fft.length : 0;

      // Overall speed multiplier — audio only nudges slightly
      const spd = isActive ? 1.0 + energy * 0.25 : isListen ? 0.85 : 0.60;

      // ── Continuous rotations ────────────────────────────────────────────────
      st.tikAngle   -=  8 * spd * dt;   // slow CCW
      st.outerAngle +=  14 * spd * dt;  // slow CW
      st.innerAngle -=  22 * spd * dt;  // faster CCW

      // ── Yellow ring: pendulum — slow sine target, springy response ──────────
      const audioBump    = isActive ? energy * 18 : 0;
      const yellowTarget = -15 + Math.sin(t * 0.28) * (48 + audioBump);
      [st.yellowAngle, st.yellowVel] = spring(
        st.yellowAngle, st.yellowVel, yellowTarget, 2.2, 3.2, dt
      );

      // ── Swing dial: ratchet-tick behaviour + pendulum swing ─────────────────
      // Periodically receive a velocity impulse (like a clock tick with momentum)
      const tickInterval = isActive ? 1.0 : isListen ? 1.4 : 2.0;
      if (t >= st.swingNextTick) {
        st.swingNextTick = t + tickInterval + (Math.random() * 0.4 - 0.2);
        // Jump the velocity — direction alternates with a slow sine
        const dir = Math.sign(Math.sin(t * 0.18));
        st.swingVel += dir * (60 + Math.random() * 30);
      }
      // The swing oscillates around a slow-moving target
      const swingTarget = -20 + Math.sin(t * 0.22) * 55;
      [st.swingAngle, st.swingVel] = spring(
        st.swingAngle, st.swingVel, swingTarget, 1.6, 2.8, dt
      );

      // ── Apply transforms directly to DOM ────────────────────────────────────
      const opacity = isActive ? 1.0 : isListen ? 0.82 : 0.55;
      const opStr   = String(opacity);

      if (tikRef.current) {
        tikRef.current.style.transform = `rotate(${st.tikAngle}deg)`;
        tikRef.current.style.opacity   = opStr;
      }
      if (outerRef.current) {
        outerRef.current.style.transform = `rotate(${st.outerAngle}deg)`;
        outerRef.current.style.opacity   = opStr;
      }
      if (innerRef.current) {
        innerRef.current.style.transform = `rotate(${st.innerAngle}deg)`;
        innerRef.current.style.opacity   = opStr;
      }
      if (yellowRef.current) {
        yellowRef.current.style.transform = `rotate(${st.yellowAngle}deg)`;
        yellowRef.current.style.opacity   = opStr;
      }
      if (swingRef.current) {
        swingRef.current.style.transform = `rotate(${st.swingAngle}deg)`;
        swingRef.current.style.opacity   = opStr;
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Shared style for every rotating layer:
  // - fills the parent exactly (position absolute, inset 0)
  // - transform-origin pinned to dead center so every layer shares the same pivot
  const layerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    transformOrigin: '50% 50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const imgStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    userSelect: 'none',
    pointerEvents: 'none',
  };

  return (
    <div style={{ position: 'absolute', inset: 0 }}>

      {/* Tick marks — outermost, slow CCW */}
      <div ref={tikRef} style={layerStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/Jarvis Original/Tik Marks.png" alt="" style={imgStyle} draggable={false} />
      </div>

      {/* Outer ring — slow CW */}
      <div ref={outerRef} style={layerStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/Jarvis Original/Outer ring.png" alt="" style={imgStyle} draggable={false} />
      </div>

      {/* Yellow arc — spring-pendulum */}
      <div ref={yellowRef} style={layerStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/Jarvis Original/yellow ring.png" alt="" style={imgStyle} draggable={false} />
      </div>

      {/* Inner ring — faster CCW */}
      <div ref={innerRef} style={layerStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/Jarvis Original/Inner ring.png" alt="" style={imgStyle} draggable={false} />
      </div>

      {/* Swing dial — ratchet-tick with momentum */}
      <div ref={swingRef} style={layerStyle}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/Jarvis Original/Swing dial.png" alt="" style={imgStyle} draggable={false} />
      </div>

    </div>
  );
}
