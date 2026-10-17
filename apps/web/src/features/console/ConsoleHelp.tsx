export function ConsoleHelp() {
  return (
    <>
      <button
        type="button"
        className="console-help-trigger"
        aria-label="控制台帮助"
        title="控制台帮助"
        popoverTarget="console-help"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4" />
          <circle cx="12" cy="16.5" r=".8" fill="currentColor" stroke="none" />
        </svg>
      </button>
      <section
        id="console-help"
        className="console-help"
        popover="auto"
        aria-labelledby="console-help-title"
      >
        <div className="console-help-heading">
          <h3 id="console-help-title">控制台帮助</h3>
          <button
            type="button"
            aria-label="关闭帮助"
            popoverTarget="console-help"
            popoverTargetAction="hide"
          >
            关闭 ×
          </button>
        </div>
        <h4>Agent 玩家 · 你的世界伙伴</h4>
        <p>
          安排任务，查看进展，和 Agent
          一起探索与搭建。在角色设置中定义伙伴的身份、职责与能力，在定时任务页安排具体任务。
        </p>
        <h4>任务安排与执行</h4>
        <p>
          支持立即执行、指定时间执行和重复执行。每次执行可包含多轮规划；长期建造目标使用一次性任务，暂停后继续已有进度。重复计划每次独立执行。
        </p>
        <p>
          暂停计划只阻止未来触发。执行异常或额度耗尽时，计划也会暂停，处理后须手动恢复。忙碌、离线或服务关闭期间错过的触发不补跑。
        </p>
        <p>
          日历安排按创建时保存的时区执行。夏令时缺失时间跳过，重复时间仅执行第一次。关闭浏览器不影响服务端调度；世界服务必须保持运行。
        </p>
        <h4>模型服务</h4>
        <p>保存模型与接口配置，在创建或编辑 Agent 时选择使用。</p>
        <h4>文本转语音（TTS）</h4>
        <p>
          将回复文字合成为声音。保存音色配置、试听效果，在创建或编辑 Agent
          时选择使用。
        </p>
        <h4>语音识别（ASR）</h4>
        <p>
          边说边查看临时字幕，停顿后自动确认整句。临时字幕会随后续语音修正。
        </p>
      </section>
    </>
  );
}
