import {
  uIOhook,
  type UiohookKeyboardEvent,
  type UiohookMouseEvent,
  type UiohookWheelEvent
} from 'uiohook-napi'
import type { EventEmitter } from 'events'

type GlobalInputEventMap = {
  input: UiohookKeyboardEvent | UiohookMouseEvent | UiohookWheelEvent
  keydown: UiohookKeyboardEvent
  keyup: UiohookKeyboardEvent
  mousedown: UiohookMouseEvent
  mouseup: UiohookMouseEvent
  mousemove: UiohookMouseEvent
  click: UiohookMouseEvent
  wheel: UiohookWheelEvent
}

class GlobalInputManager {
  // uIOhook 是进程级单例。用 consumer 引用计数管理 start/stop，避免一个模块 stop 掉其他模块的监听。
  private consumers = new Set<string>()
  // listener 按 consumer 归属记录，release 时只 off 当前模块注册的事件。
  private listenersByConsumer = new Map<
    string,
    Array<{
      event: keyof GlobalInputEventMap
      listener: (...args: unknown[]) => void
    }>
  >()
  private started = false

  public on<K extends keyof GlobalInputEventMap>(
    consumer: string,
    event: K,
    listener: (event: GlobalInputEventMap[K]) => void
  ): void {
    const eventListener = listener as (...args: unknown[]) => void
    ;(uIOhook as EventEmitter).on(event, eventListener)

    const listeners = this.listenersByConsumer.get(consumer) ?? []
    listeners.push({ event, listener: eventListener })
    this.listenersByConsumer.set(consumer, listeners)
  }

  public acquire(consumer: string): boolean {
    this.consumers.add(consumer)
    if (this.started) return true

    try {
      uIOhook.start()
      this.started = true
      console.log('[GlobalInput] 全局输入监听已启动')
      return true
    } catch (error) {
      this.consumers.delete(consumer)
      console.error('[GlobalInput] 启动全局输入监听失败:', error)
      if (process.platform === 'linux') {
        console.error(
          '[GlobalInput] 提示: Linux 下可能需要将用户加入 input 组 (sudo usermod -aG input $USER) 或以 root 运行'
        )
      }
      return false
    }
  }

  public release(consumer: string): void {
    const listeners = this.listenersByConsumer.get(consumer) ?? []
    for (const { event, listener } of listeners) {
      ;(uIOhook as EventEmitter).off(event, listener)
    }
    this.listenersByConsumer.delete(consumer)

    this.consumers.delete(consumer)
    // 仍有其他模块依赖全局输入时，不能停止底层 uIOhook。
    if (!this.started || this.consumers.size > 0) return

    try {
      uIOhook.stop()
      console.log('[GlobalInput] 全局输入监听已停止')
    } catch (error) {
      console.error('[GlobalInput] 停止全局输入监听失败:', error)
    } finally {
      this.started = false
    }
  }
}

export default new GlobalInputManager()
