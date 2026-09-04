'use client';

type ConfigProps = {
  type: string;
  config: Record<string, unknown>;
  bindings: string[];
  onChange: (config: Record<string, unknown>) => void;
};

export function WorkflowConfig({ type, config, bindings, onChange }: ConfigProps) {
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const text = (key: string, fallback = '') => String(config[key] ?? fallback);
  return (
    <div className="builder-form">
      {['enrich', 'waterfall'].includes(type) && (
        <>
          <label className="field-label">
            Provider
            <input
              value={text('provider', 'mock')}
              onChange={(event) => set('provider', event.target.value)}
            />
          </label>
          <label className="field-label">
            Action
            <input
              value={text('action', type === 'waterfall' ? 'mock.findEmail' : 'mock.enrichPerson')}
              onChange={(event) => set('action', event.target.value)}
            />
          </label>
          <label className="field-label">
            Input bindings JSON
            <textarea
              value={JSON.stringify(config.input ?? {}, null, 2)}
              onChange={(event) => {
                try {
                  set('input', JSON.parse(event.target.value));
                } catch {
                  /* keep editing */
                }
              }}
            />
          </label>
          {type === 'waterfall' && (
            <label className="field-label">
              Accept rule
              <select
                value={text('accept', 'any')}
                onChange={(event) => set('accept', event.target.value)}
              >
                <option value="any">Any found result</option>
                <option value="verified-email-only">Verified email only</option>
              </select>
            </label>
          )}
        </>
      )}
      {type === 'agent' && (
        <>
          <label className="field-label">
            Provider
            <input
              value={text('provider', 'openai')}
              onChange={(event) => set('provider', event.target.value)}
            />
          </label>
          <label className="field-label">
            Prompt
            <textarea
              value={text('prompt')}
              onChange={(event) => set('prompt', event.target.value)}
            />
          </label>
          <label className="field-label">
            Model
            <input value={text('model')} onChange={(event) => set('model', event.target.value)} />
          </label>
        </>
      )}
      {type === 'formula' && (
        <label className="field-label">
          Expression
          <textarea
            value={text('expression')}
            onChange={(event) => set('expression', event.target.value)}
          />
        </label>
      )}
      {type === 'condition' && (
        <label className="field-label">
          Condition expression
          <textarea
            value={text('expression')}
            onChange={(event) => set('expression', event.target.value)}
          />
        </label>
      )}
      {type === 'http' && (
        <>
          <label className="field-label">
            Method
            <input
              value={text('method', 'GET')}
              onChange={(event) => set('method', event.target.value.toUpperCase())}
            />
          </label>
          <label className="field-label">
            URL
            <input value={text('url')} onChange={(event) => set('url', event.target.value)} />
          </label>
          <label className="field-label">
            Headers JSON
            <textarea
              value={JSON.stringify(config.headers ?? {}, null, 2)}
              onChange={(event) => {
                try {
                  set('headers', JSON.parse(event.target.value));
                } catch {
                  /* keep editing */
                }
              }}
            />
          </label>
          <label className="field-label">
            Body template
            <textarea value={text('body')} onChange={(event) => set('body', event.target.value)} />
          </label>
          <label className="field-label">
            JSON output path
            <input
              value={text('outputPath')}
              onChange={(event) => set('outputPath', event.target.value)}
            />
          </label>
        </>
      )}
      {type === 'function' && (
        <>
          <label className="field-label">
            Function ID
            <input
              value={text('functionId')}
              onChange={(event) => set('functionId', event.target.value)}
            />
          </label>
          <label className="field-label">
            Version
            <input
              type="number"
              value={text('version')}
              onChange={(event) => set('version', Number(event.target.value))}
            />
          </label>
          <label className="field-label">
            Input bindings JSON
            <textarea
              value={JSON.stringify(config.input ?? {}, null, 2)}
              onChange={(event) => {
                try {
                  set('input', JSON.parse(event.target.value));
                } catch {
                  /* keep editing */
                }
              }}
            />
          </label>
        </>
      )}
      {type === 'table.appendRow' && (
        <>
          <label className="field-label">
            Table ID
            <input
              value={text('tableId')}
              onChange={(event) => set('tableId', event.target.value)}
            />
          </label>
          <label className="field-label">
            Values mapping JSON
            <textarea
              value={JSON.stringify(config.values ?? {}, null, 2)}
              onChange={(event) => {
                try {
                  set('values', JSON.parse(event.target.value));
                } catch {
                  /* keep editing */
                }
              }}
            />
          </label>
        </>
      )}
      {type === 'audience.upsert' && (
        <label className="field-label">
          Email binding
          <input value={text('email')} onChange={(event) => set('email', event.target.value)} />
        </label>
      )}
      {type === 'delay' && (
        <label className="field-label">
          Milliseconds
          <input
            type="number"
            value={text('ms', '0')}
            onChange={(event) => set('ms', Number(event.target.value))}
          />
        </label>
      )}
      {type === 'webhook.out' && (
        <>
          <label className="field-label">
            Webhook URL
            <input value={text('url')} onChange={(event) => set('url', event.target.value)} />
          </label>
          <label className="field-label">
            Body template
            <textarea value={text('body')} onChange={(event) => set('body', event.target.value)} />
          </label>
        </>
      )}
      {type === 'trigger.signal' && (
        <label className="field-label">
          Signal definition ID
          <input
            value={text('definitionId')}
            onChange={(event) => set('definitionId', event.target.value)}
          />
        </label>
      )}
      {type === 'trigger.schedule' && (
        <label className="field-label">
          Cron schedule
          <input
            value={text('cron', '0 * * * *')}
            onChange={(event) => set('cron', event.target.value)}
          />
        </label>
      )}
      {type === 'trigger.webhook' && (
        <label className="field-label">
          Webhook secret
          <input value={text('secret')} readOnly />
        </label>
      )}
      {bindings.length > 0 && (
        <div className="binding-helper">
          <strong>Bindings</strong>
          <div className="binding-list">
            {bindings.map((binding) => (
              <button
                type="button"
                className="chip"
                key={binding}
                onClick={() => set('binding', binding)}
              >
                {binding}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
