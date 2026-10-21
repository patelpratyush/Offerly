// Sequential mapping preserves transaction/savepoint ordering.
export async function mapAsync(values, fn) {
  const result = [];
  for (let index = 0; index < values.length; index++)
    result.push(await fn(values[index], index));
  return result;
}
