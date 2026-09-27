import jsonUrl from './local.json' with { type: 'url' };
sideEffect(typeof jsonUrl === 'string' && /local-[0-9a-z]+\.json$/.test(jsonUrl));
