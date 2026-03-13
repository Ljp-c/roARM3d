/**
 * Web Serial API 串口管理模块
 * 支持格式: J1=45&J2=90&J3=120
 */

import { SerialData, SerialStatus, SerialLogEntry, SerialConfig } from "../types/serial";

// Web Serial API 类型声明
declare global {
  interface Navigator {
    serial: {
      requestPort(): Promise<SerialPort>;
    };
  }

  interface SerialPort {
    open(options: SerialOptions): Promise<void>;
    close(): Promise<void>;
    readable: ReadableStream<Uint8Array> | null;
    writable: WritableStream<Uint8Array> | null;
  }

  interface SerialOptions {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: "none" | "even" | "odd";
  }
}

export class SerialPortManager {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private status: SerialStatus = "disconnected";
  private logs: SerialLogEntry[] = [];
  private lastError: string | null = null;
  private dataCallbacks: Set<(data: SerialData) => void> = new Set();
  private statusCallbacks: Set<(status: SerialStatus) => void> = new Set();
  private buffer: string = "";
  private isReading: boolean = false;

  constructor() {
    this.addLog("info", "SerialPortManager 已初始化");
  }

  /**
   * 检查浏览器是否支持 Web Serial API
   */
  isSupported(): boolean {
    return "serial" in navigator;
  }

  /**
   * 获取当前连接状态
   */
  getStatus(): SerialStatus {
    return this.status;
  }

  /**
   * 获取日志列表
   */
  getLogs(): SerialLogEntry[] {
    return this.logs;
  }

  /**
   * 获取最后一个错误信息
   */
  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * 连接到串口
   */
  async connect(config: SerialConfig): Promise<void> {
    try {
      if (!this.isSupported()) {
        throw new Error("浏览器不支持 Web Serial API");
      }

      if (this.port) {
        throw new Error("已有串口连接");
      }

      this.setStatus("connecting");
      this.addLog("info", `正在连接串口，波特率: ${config.baudRate}`);

      // 使用 requestPort() 让用户选择串口
      this.port = await (navigator as any).serial.requestPort();

      // 打开串口
      await this.port.open({
        baudRate: config.baudRate,
        dataBits: config.dataBits || 8,
        stopBits: config.stopBits || 1,
        parity: config.parity || "none",
      });

      this.setStatus("connected");
      this.addLog("info", "串口已连接");

      // 启动读取循环
      this.startReading();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.setStatus("error");
      this.addLog("error", `连接失败: ${message}`);
      throw error;
    }
  }

  /**
   * 断开串口连接
   */
  async disconnect(): Promise<void> {
    try {
      this.isReading = false;

      if (this.reader) {
        await this.reader.cancel();
        this.reader = null;
      }

      if (this.port) {
        await this.port.close();
        this.port = null;
      }

      this.buffer = "";
      this.setStatus("disconnected");
      this.addLog("info", "串口已断开");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastError = message;
      this.setStatus("error");
      this.addLog("error", `断开失败: ${message}`);
      throw error;
    }
  }

  /**
   * 启动数据读取循环
   */
  private async startReading(): Promise<void> {
    if (!this.port) return;

    try {
      this.isReading = true;
      const reader = this.port.readable!.getReader();
      this.reader = reader;

      while (this.isReading) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        if (value) {
          // 将字节数组转换为字符串
          const text = new TextDecoder().decode(value);
          this.buffer += text;

          // 处理缓冲区中的完整数据行
          this.processBuffer();
        }
      }
    } catch (error) {
      if (this.isReading) {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = message;
        this.setStatus("error");
        this.addLog("error", `读取错误: ${message}`);
      }
    }
  }

  /**
   * 处理缓冲区数据，提取完整的数据行
   */
  private processBuffer(): void {
    // 按行分割（支持 \n 或 \r\n）
    const lines = this.buffer.split(/\r?\n/);

    // 保留最后一个不完整的行在缓冲区中
    this.buffer = lines[lines.length - 1];

    // 处理所有完整的行
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (line) {
        this.parseLine(line);
      }
    }
  }

  /**
   * 解析单行数据
   * 支持多种格式:
   * - J1=45&J2=90&J3=120
   * - J1:45 J2:90 J3:120
   * - J1 45 J2 90 J3 120
   * - {J1:45, J2:90} (JSON 格式)
   */
  private parseLine(line: string): void {
    try {
      const data: SerialData = {};

      // 先尝试 JSON 格式
      if (line.trim().startsWith('{') && line.trim().endsWith('}')) {
        try {
          const jsonData = JSON.parse(line);
          for (const [key, value] of Object.entries(jsonData)) {
            const numValue = parseFloat(value as string);
            if (!isNaN(numValue)) {
              data[key.trim().toUpperCase()] = numValue;
            }
          }
        } catch {
          // JSON 解析失败，继续尝试其他格式
        }
      }

      // 如果 JSON 解析失败或数据为空，尝试其他格式
      if (Object.keys(data).length === 0) {
        // 支持多种分隔符: & 空格 逗号 分号
        const separators = /[&\s,;]+/;
        const pairs = line.split(separators).filter(p => p.trim());

        for (const pair of pairs) {
          // 支持 = : 或空格作为键值分隔符
          let key: string | undefined;
          let value: string | undefined;

          if (pair.includes('=')) {
            [key, value] = pair.split('=');
          } else if (pair.includes(':')) {
            [key, value] = pair.split(':');
          } else {
            // 如果只是两个连续的 token，可能是 "J1 45" 格式
            // 这种情况下我们需要更复杂的解析逻辑，暂时先跳过
            continue;
          }

          if (key && value) {
            const trimmedKey = key.trim().toUpperCase();
            const numValue = parseFloat(value.trim());

            if (!isNaN(numValue)) {
              data[trimmedKey] = numValue;
            } else {
              this.addLog(
                "warning",
                `无效的数值: ${trimmedKey}=${value}`
              );
            }
          }
        }
      }

      if (Object.keys(data).length > 0) {
        this.addLog("data", `收到数据: ${JSON.stringify(data)}`, data);
        // 触发所有回调
        this.dataCallbacks.forEach((callback) => callback(data));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addLog("error", `解析错误: ${message}`);
    }
  }

  /**
   * 注册数据接收回调
   */
  onDataReceived(callback: (data: SerialData) => void): () => void {
    this.dataCallbacks.add(callback);
    return () => this.dataCallbacks.delete(callback);
  }

  /**
   * 注册状态改变回调
   */
  onStatusChanged(callback: (status: SerialStatus) => void): () => void {
    this.statusCallbacks.add(callback);
    return () => this.statusCallbacks.delete(callback);
  }

  /**
   * 设置状态并触发回调
   */
  private setStatus(status: SerialStatus): void {
    this.status = status;
    this.statusCallbacks.forEach((callback) => callback(status));
  }

  /**
   * 添加日志条目
   */
  private addLog(
    type: "info" | "warning" | "error" | "data",
    message: string,
    data?: unknown
  ): void {
    const entry: SerialLogEntry = {
      id: `log-${Date.now()}-${Math.random()}`,
      timestamp: Date.now(),
      type,
      message,
      data,
    };

    this.logs.push(entry);

    // 只保留最近 100 条日志
    if (this.logs.length > 100) {
      this.logs.shift();
    }
  }

  /**
   * 清空日志
   */
  clearLogs(): void {
    this.logs = [];
    this.addLog("info", "日志已清空");
  }
}

// 创建全局单例
export const serialManager = new SerialPortManager();
