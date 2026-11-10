import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

function isConditionalCheckFailure(error) {
  return error?.name === 'ConditionalCheckFailedException';
}

export function createDynamoStore({ tableName, client = new DynamoDBClient({}) }) {
  const documentClient = DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });

  return {
    async get(pk, sk) {
      const { Item } = await documentClient.send(new GetCommand({
        TableName: tableName,
        Key: { pk, sk },
        ConsistentRead: true,
      }));
      return Item ?? null;
    },

    // Devuelve true solo si creó el elemento. La condición hace que dos
    // solicitudes concurrentes no puedan guardar banderas distintas.
    async putIfAbsent(item) {
      try {
        await documentClient.send(new PutCommand({
          TableName: tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk)',
        }));
        return true;
      } catch (error) {
        if (isConditionalCheckFailure(error)) return false;
        throw error;
      }
    },

    async put(item) {
      await documentClient.send(new PutCommand({
        TableName: tableName,
        Item: item,
      }));
    },

    async update(pk, sk, { set = {}, add = {} } = {}) {
      const names = {};
      const values = {};
      const setClauses = [];
      const addClauses = [];
      let index = 0;

      for (const [attribute, value] of Object.entries(set)) {
        const nameKey = `#n${index}`;
        const valueKey = `:v${index}`;
        names[nameKey] = attribute;
        values[valueKey] = value;
        setClauses.push(`${nameKey} = ${valueKey}`);
        index += 1;
      }

      for (const [attribute, value] of Object.entries(add)) {
        const nameKey = `#n${index}`;
        const valueKey = `:v${index}`;
        names[nameKey] = attribute;
        values[valueKey] = value;
        addClauses.push(`${nameKey} ${valueKey}`);
        index += 1;
      }

      if (setClauses.length === 0 && addClauses.length === 0) {
        throw new Error('La actualización no contiene cambios');
      }

      const expression = [
        setClauses.length > 0 ? `SET ${setClauses.join(', ')}` : '',
        addClauses.length > 0 ? `ADD ${addClauses.join(', ')}` : '',
      ].filter(Boolean).join(' ');

      const { Attributes } = await documentClient.send(new UpdateCommand({
        TableName: tableName,
        Key: { pk, sk },
        UpdateExpression: expression,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }));
      return Attributes ?? null;
    },
  };
}
