import express from "express";
import pkg from "pg";
const { Pool } = pkg;

/*if (!process.env.PORT) {
    throw new Error("Please specify the port number for the HTTP server with the environment variable PORT.");
}

if (!process.env.DATABASE_URL) {
    throw new Error("Please specify the PostgreSQL connection string using environment variable DATABASE_URL.");
}

if (!process.env.DB_TABLE) {
    throw new Error("Please specify the PostgreSQL table name using environment variable DB_TABLE.");
}*/

const PORT = Number(process.env.PORT);
const DATABASE_URL = process.env.DATABASE_URL;
const DB_TABLE = process.env.DB_TABLE;
const DB_SCHEMA = process.env.DB_SCHEMA;

function quoteIdentifier(identifier) {
    return `"${String(identifier).replace(/"/g, '""')}"`;
}

function buildQualifiedTableName(schemaName, tableName) {
    return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}

/*const pool = new Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'postgres',
    database: 'lucky'
});*/

async function loadTableMetadata(schemaName, tableName) {
    const columnsResult = await pool.query(
        `SELECT 
            column_name, 
            is_nullable, 
            column_default, 
            data_type, 
            udt_name, 
            ordinal_position
        FROM 
            information_schema.columns
        WHERE table_schema = $1
            AND table_name = $2
        ORDER BY ordinal_position;
        `,
        [schemaName, tableName]
    );

    if (columnsResult.rows.length === 0) {
        throw new Error(`Table ${schemaName}.${tableName} was not found or has no columns.`);
    }

    const primaryKeyResult = await pool.query(
        `SELECT a.attname AS column_name
        FROM pg_index i 
        JOIN pg_class c ON c.oid = i.indrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace 
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
        WHERE i.indisprimary = true 
            AND n.nspname = $1
            AND c.relname = $2;
        `,
        [schemaName, tableName]
    );

    const primaryKeyNames = new Set(primaryKeyResult.rows.map(row => row.column_name));

    const columns = columnsResult.rows.map(row => ({
        name: row.column_name,
        ordinalPosition: row.ordinal_position,
        isNullable: row.is_nullable === "YES",
        hasDefault: row.column_default !== null,
        isPrimaryKey: primaryKeyNames.has(row.column_name), // if the primary key set contains the current column name
        dataType: row.data_type,
        udtName: row.udt_name,

    }));

    // get all primaryKeys = true column
    let primaryKeys = columns.filter(column => column.isPrimaryKey);

    // find name by id 
    if (primaryKeys.length === 0) {
        const conventionalIdColumn = columns.find(column => column.name === "id");
        if (conventionalIdColumn) {
            conventionalIdColumn.isPrimaryKey = true;
            conventionalIdColumn.hasDefault = true;
            primaryKeys = [conventionalIdColumn];
        }
    }

    if (primaryKeys.length !== 1) {
        throw new Error(`Expected exactly one primary key column on ${schemaName}.${tableName}, found ${primaryKeys.length}`);
    }

    const primaryKey = primaryKeys[0];
    const writableColumns = columns.filter(column => !column.hasDefault); // true is if column.hasDefault has a value that's not null. false is if it's null
    const updateableColumns = columns.filter(column => !column.isPrimaryKey); // update the ones that are not primary keys

    return {
        columns,
        primaryKey,
        writableColumns,
        updateableColumns,
        qualifiedTableName: buildQualifiedTableName(schemaName, tableName),
    };
}

function parsePrimaryKeyValue(rawValue, primaryKey) {
    if (rawValue == undefined || rawValue == null || rawValue == "") {
        throw new Error(`Please provide a value for primary key column '${primaryKey.name}'.`);
    }

    if (["int2", "int4", "int8"].includes(primaryKey.udtName)) { // if the primaryKey type is an int2, int4, int8, transform the rawValue into a number
        const parsed = Number(rawValue);
        if (!Number.isInteger(parsed)) {
            throw new Error(`Primary key '${primaryKey.name}' must be an integer.`);
        }
        return parsed;
    }

    return rawValue;
}

function pickAllowedFields(body, allowedColumns) { // allowedColumns come from metadata. check columns of body to make sure they're in allowedColumns
    const allowedNames = new Set(allowedColumns.map(column => column.name));
    const payload = {}

    for (const [key, value] of Object.entries(body || {})) {
        if (allowedNames.has(key) && value !== undefined) {
            payload[key] = value;
        }
    }

    return payload; // payload object is returned. 
}

function buildInsertStatement(metadata, payload) {
    const keys = Object.keys(payload);

    if (keys.length === 0) {
        const acceptedColumns = metadata.writableColumns.map(column => column.name);
        throw new Error(
            acceptedColumns.length > 0
                ? `Request body must include at least one of these columns: ${acceptedColumns.join(", ")}.`
                : `No writable columns were detected for table ${DB_SCHEMA}.${DB_TABLE}.`
        );
    }

    const columnsSql = keys.map(quoteIdentifier).join(", ");
    const valuesSql = keys.map((_, index) => `$${index + 1}`).join(", ");
    return {
        text: `INSERT INTO ${metadata.qualifiedTableName} (${columnsSql}) VALUES (${valuesSql}) RETURNING *;`,
        values: keys.map(key => payload[key]),
    };
}

function buildUpdateStatement(metadata, id, payload) {
    const keys = Object.keys(payload);
    if (keys.length === 0) {
        const acceptedColumns = metadata.updateableColumns.map(column => column.name);
        throw new Error(
            acceptedColumns.length > 0
                ? `Request body must include at least one updateable column: ${acceptedColumns.join(", ")}.`
                : `No updateable columns were detected for table ${DB_SCHEMA}.${DB_TABLE}.`
        );
    }

    const assignmentsSql = keys.map((key, index) => `${quoteIdentifier(key)} = $${index + 1}`)
        .join(", ");

    return {
        text: `
            UPDATE ${metadata.qualifiedTableName}
            SET ${assignmentsSql}
            WHERE ${quoteIdentifier(metadata.primaryKey.name)} = $${keys.length + 1}
            RETURNING *; 
        `,
        values: [...keys.map(key => payload[key]), id]
    };
}

const obj1 = {
    name: "John",
    age: 30
}

console.dir(obj1, { depth: null });

const pool = new Pool({
    connectionString: DATABASE_URL,
});

async function main() {
    console.log(typeof DATABASE_URL, DATABASE_URL);
    const metadata = await loadTableMetadata(DB_SCHEMA, DB_TABLE);

    console.log(`
        Connected to PostgreSQL table ${DB_SCHEMA}.${DB_TABLE}. Primary key: ${metadata.primaryKey.name}.
        `);

    const app = express();
    app.use(express.json());

    app.get("/", (req, res) => {
        res.send("API is running.");
    });

    app.get("/health", async (req, res) => {
        await pool.query("SELECT 1");
        res.json({ status: "ok" });
    });

    app.get("/employees", async (req, res) => {
        const result = await pool.query(
            `SELECT * FROM ${metadata.qualifiedTableName} ORDER BY ${quoteIdentifier(metadata.primaryKey.name)} ASC;`
        ); // SELECT * FROM "public"."employees" ORDER BY primaryKey.name (id), sort by ascending ID
        res.json({ employees: result.rows });
    });

    app.get("/employees/:id", async (req, res) => {
        const id = parsePrimaryKeyValue(req.params.id, metadata.primaryKey);

        const result = await pool.query(`SELECT * FROM ${metadata.qualifiedTableName} WHERE ${quoteIdentifier(metadata.primaryKey.name)} = $1;`,
            [id]
        ); // select * from "public"."employees" WHERE "id" = $1, [id]

        if (result.rows.length === 0) {
            res.sendStatus(404);
            return;
        }

        res.json({ employee: result.rows[0] }); // need result.rows[0] for the object 
    });

    app.post("/employees", async (req, res) => {

        console.log(`req.body`, req.body);

        const payload = pickAllowedFields(req.body, metadata.writableColumns);
        console.log(`payload`, payload);
        const query = buildInsertStatement(metadata, payload);

        const result = await pool.query(query);

        res.status(201).json({ employee: result.rows[0] });
    });

    app.put("/employees/:id", async (req, res) => {
        const id = parsePrimaryKeyValue(req.params.id, metadata.primaryKey);
        // payload is column names without values 
        const payload = pickAllowedFields(req.body, metadata.updateableColumns); // if the columns of req.body are in updateableColumns, keep them
        const query = buildUpdateStatement(metadata, id, payload);

        const result = await pool.query(query);

        if (result.rows.length === 0) {
            res.sendStatus(404);
            return;
        }

        res.json({ employee: result.rows[0] });
    });

    app.delete("/employees/:id", async (req, res) => {
        const id = parsePrimaryKeyValue(req.params.id, metadata.primaryKey);
        const result = await pool.query(
            `DELETE FROM ${metadata.qualifiedTableName} WHERE ${quoteIdentifier(metadata.primaryKey.name)} = $1 RETURNING *;`,
            [id]
        );
        console.log(result);

        if (result.rows.length === 0) {
            res.sendStatus(404);
            return;
        }

        res.json({ deleted: true, employee: result.rows[0] });
    });

    app.listen(3000, () => {
        console.log("Server started on port 3000");
    });

}

main();
