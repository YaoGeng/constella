// C-12 <SkyBackground/> React 宿主（TDD-C-12 §1）：挂载 canvas+帧循环+通道注册；
// 卸载=cancelAnimationFrame+移除监听（03 §1）。DOM= demo L586-588 三兄弟（canvas#sky/#vignette/#fade）。
// 挂载到视图根（z 序垫底）归 T6-17 应用壳卡——本组件只交付自身。
// P-3：零模块运行时 import（控制全经 window 通道；唯一依赖面=@constella/shared 类型 + react 宿主本体）。
import { useEffect, useRef } from 'react';
import { mountSky, type SkyHandle } from './sky-canvas';

export function SkyBackground() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const handle: SkyHandle = mountSky(canvas);
    return () => handle.dispose();
  }, []);
  return (
    <>
      <canvas id="sky" ref={ref} />
      <div id="vignette" />
      <div id="fade" />
    </>
  );
}
