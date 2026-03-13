/**
 * 串口通讯相关类型定义
 */

/** 解析后的串口数据对象 */
export interface SerialData {
  [key: string]: number; // 例如: { J1: 45, J2: 90, J3: 120 }
}

/** 关节绑定配置 - 映射关节ID到串口字段名 */
export interface SerialBindings {
  [partId: string]: string; // 例如: { "part-1": "J1", "part-2": "J2" }
}

/** 串口状态 */
export type SerialStatus = 
  | "disconnected"  // 未连接
  | "connecting"    // 连接中
  | "connected"     // 已连接
  | "error";        // 错误状态

/** 串口日志条目 */
export interface SerialLogEntry {
  id: string;
  timestamp: number;
  type: "info" | "warning" | "error" | "data";
  message: string;
  data?: unknown;
}

/** 串口管理器接口 */
export interface SerialPortManager {
  isSupported: boolean;
  status: SerialStatus;
  connect: (baudRate: number) => Promise<void>;
  disconnect: () => Promise<void>;
  onDataReceived: (callback: (data: SerialData) => void) => void;
  logs: SerialLogEntry[];
  lastError: string | null;
}

/** 串口连接配置 */
export interface SerialConfig {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: "none" | "even" | "odd";
}
