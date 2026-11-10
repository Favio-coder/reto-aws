function keyOf(pk, sk) {
  return `${pk}\u0000${sk}`;
}

function copy(value) {
  return structuredClone(value);
}

// Implementación en memoria con la misma interfaz que createDynamoStore.
// Solo para pruebas locales; no sustituye a DynamoDB.
export function createMemoryStore({ delayConditionalPut = false } = {}) {
  const data = new Map();

  return {
    async get(pk, sk) {
      const item = data.get(keyOf(pk, sk));
      return item ? copy(item) : null;
    },

    async putIfAbsent(item) {
      if (delayConditionalPut) {
        await new Promise(resolve => setImmediate(resolve));
      }
      const key = keyOf(item.pk, item.sk);
      if (data.has(key)) return false;
      data.set(key, copy(item));
      return true;
    },

    async put(item) {
      data.set(keyOf(item.pk, item.sk), copy(item));
    },

    async update(pk, sk, { set = {}, add = {} } = {}) {
      const key = keyOf(pk, sk);
      const next = copy(data.get(key) ?? { pk, sk });
      for (const [attribute, value] of Object.entries(set)) {
        next[attribute] = value;
      }
      for (const [attribute, value] of Object.entries(add)) {
        next[attribute] = (Number(next[attribute]) || 0) + value;
      }
      data.set(key, next);
      return copy(next);
    },

    items() {
      return [...data.values()].map(copy);
    },
  };
}
