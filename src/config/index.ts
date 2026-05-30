import Conf from 'conf';

export interface Config {
  model: string;
  fallbackModel: string;
  apiKey?: string;
}

const defaults: Config = {
  model: 'openai/gpt-oss-120b:free',
  fallbackModel: 'z-ai/glm-4.5-air:free',
};

const config = new Conf<Config>({
  projectName: 'commitaj',
  defaults,
});

export const getConfig = (): Config => {
  const store = config.store;
  let migrated = false;

  // Purge legacy style key from configuration cache if present
  if ('style' in store) {
    config.delete('style' as any);
    migrated = true;
  }

  if (store.model === 'deepseek/deepseek-v4-flash:free') {
    config.set('model', 'openai/gpt-oss-120b:free');
    migrated = true;
  }
  if (store.fallbackModel === 'meta-llama/llama-3.3-70b-instruct:free') {
    config.set('fallbackModel', 'z-ai/glm-4.5-air:free');
    migrated = true;
  }
  return migrated ? config.store : store;
};

export const setConfig = <K extends keyof Config>(key: K, value: Config[K]): void => {
  config.set(key, value);
};

export const deleteConfig = (key: keyof Config): void => {
  config.delete(key);
};

export const clearConfig = (): void => {
  config.clear();
};
