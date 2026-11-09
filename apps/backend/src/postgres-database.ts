import { Prisma, type PrismaClient } from '@prisma/client'
import type {
  SqlDatabase,
  SqlExecutor,
  SqlParameters,
  SqlRow,
  SqlValue,
} from '../../web/src/infrastructure/database/types.js'

type PostgresClient = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>

function normalizePostgresRow<Row extends SqlRow>(row: Row): Row {
  const normalized: Record<string, SqlValue> = {}
  for (const [column, value] of Object.entries(row)) {
    normalized[column] = typeof value === 'boolean' ? Number(value) : value
  }
  return normalized as Row
}

function bindPostgresParameters(statement: string): string {
  let parameterIndex = 0
  let quote: "'" | '"' | null = null
  let result = ''
  for (let index = 0; index < statement.length; index += 1) {
    const character = statement[index]
    if (quote) {
      result += character
      if (character === quote) {
        if (statement[index + 1] === quote) {
          result += statement[index + 1]
          index += 1
        } else {
          quote = null
        }
      }
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      result += character
    } else if (character === '?') {
      parameterIndex += 1
      result += `$${parameterIndex}`
    } else {
      result += character
    }
  }
  return result
}

class PostgresExecutor implements SqlExecutor {
  constructor(private readonly client: PostgresClient) {}

  async execute(statement: string): Promise<void> {
    await this.client.$executeRawUnsafe(bindPostgresParameters(statement))
  }

  async run(statement: string, parameters: SqlParameters = []): Promise<number> {
    return this.client.$executeRawUnsafe(bindPostgresParameters(statement), ...parameters)
  }

  async query<Row extends SqlRow = SqlRow>(
    statement: string,
    parameters: SqlParameters = [],
  ): Promise<Row[]> {
    const rows = await this.client.$queryRawUnsafe<Row[]>(
      bindPostgresParameters(statement),
      ...parameters,
    )
    return rows.map(normalizePostgresRow)
  }
}

export class PostgresDatabase extends PostgresExecutor implements SqlDatabase {
  constructor(private readonly prisma: PrismaClient) {
    super(prisma)
  }

  async withTransaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (transaction) => work(new PostgresExecutor(transaction)),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        )
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== 'P2034' ||
          attempt >= 2
        ) {
          throw error
        }
      }
    }
  }
}
