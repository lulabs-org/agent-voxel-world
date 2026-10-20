import { AI_CHARACTER_LOG_LIMIT, type AICharacterView } from '@voxel/shared';
export function AICharacterLogViewer({ job }: { job: AICharacterView }) {
  return (
    <section className="agents-activity" aria-label="运行记录与用量">
      <div className="agents-usage">
        <div>
          <span className="agents-section-label">累计模型调用</span>
          <strong>
            {job.usage?.calls ?? 0}
            <small> 次</small>
          </strong>
        </div>
        <div>
          <span className="agents-section-label">累计 tokens</span>
          <strong>
            {job.usage?.estimated ? '约 ' : ''}
            {(job.usage?.tokens ?? 0).toLocaleString()}
          </strong>
        </div>
      </div>
      {job.lastResponse && (
        <div className="agents-progress">
          <span className="agents-section-label">最近回复</span>
          <p>{job.lastResponse}</p>
        </div>
      )}
      <div className="agents-task-heading">
        <h4>最近运行记录</h4>
        <span className="agent-hint">
          最多保留 {AI_CHARACTER_LOG_LIMIT} 条 · 最新在上 · 本地时间
        </span>
      </div>
      {job.logs.length ? (
        <ol className="agents-log-list">
          {[...job.logs].reverse().map((message, index) => {
            const timestamp = job.logTimes?.[job.logs.length - index - 1];
            const date =
              typeof timestamp === 'number' ? new Date(timestamp) : undefined;
            const valid = date && Number.isFinite(date.getTime());
            return (
              <li key={`${job.logs.length - index}-${message}`}>
                {valid ? (
                  <time
                    dateTime={date.toISOString()}
                    title={date.toISOString()}
                  >
                    {date.toLocaleString('zh-CN', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: false,
                    })}
                  </time>
                ) : (
                  <span className="agents-log-time">时间未记录</span>
                )}
                <span>{message}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="agents-list-empty">
          暂时没有运行记录。加入世界或执行任务后会显示在这里。
        </p>
      )}
    </section>
  );
}
