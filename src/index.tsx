// 保持模块静态有序执行：setupRuntime 先完成全局 Polyfill、TV 模式检测与原生桥挂载，
// 随后直接同步执行 bootstrap 挂载 React，彻底消除动态 import('./bootstrap') 触发的
// 85 个 chunk __vitePreload 瀑布流与 CSS link onload 死锁（修复 TCL Q9K 等电视启动超时）。
import './setupRuntime';
import './bootstrap';
