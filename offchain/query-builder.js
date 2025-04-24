/**
 * Query Builder per il Layer-2 su Solana
 * 
 * Questo modulo implementa un costruttore di query SQL sicuro che utilizza
 * parametrizzazione per prevenire vulnerabilità SQL Injection.
 * Supporta la costruzione di query complesse in modo sicuro e flessibile.
 */

/**
 * Classe QueryBuilder
 * 
 * Costruisce query SQL in modo sicuro utilizzando parametrizzazione
 * per prevenire attacchi SQL Injection.
 */
class QueryBuilder {
    /**
     * Costruttore
     * @param {string} table - La tabella principale della query
     */
    constructor(table) {
        this.table = table;
        this.selectClauses = [];
        this.whereClauses = [];
        this.joinClauses = [];
        this.orderByClauses = [];
        this.groupByClauses = [];
        this.havingClauses = [];
        this.limitValue = null;
        this.offsetValue = null;
        this.params = [];
        this.distinct = false;
        this.updateValues = {};
        this.insertValues = {};
        this.queryType = 'select'; // select, insert, update, delete
    }

    /**
     * Imposta la query come SELECT
     * @param {...string} columns - Le colonne da selezionare
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    select(...columns) {
        this.queryType = 'select';
        
        if (columns.length === 0) {
            this.selectClauses.push('*');
        } else {
            this.selectClauses = columns.map(column => {
                // Sanitizza i nomi delle colonne per prevenire SQL injection
                // Nota: i nomi delle colonne non possono essere parametrizzati
                return this.sanitizeIdentifier(column);
            });
        }
        
        return this;
    }

    /**
     * Imposta la query come SELECT DISTINCT
     * @param {...string} columns - Le colonne da selezionare
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    selectDistinct(...columns) {
        this.distinct = true;
        return this.select(...columns);
    }

    /**
     * Aggiunge una funzione di aggregazione alla query SELECT
     * @param {string} fn - La funzione di aggregazione (COUNT, SUM, AVG, MIN, MAX)
     * @param {string} column - La colonna su cui applicare la funzione
     * @param {string} alias - L'alias per il risultato
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    aggregate(fn, column, alias) {
        const sanitizedFn = this.sanitizeIdentifier(fn.toUpperCase());
        const sanitizedColumn = column === '*' ? '*' : this.sanitizeIdentifier(column);
        const sanitizedAlias = alias ? ` AS ${this.sanitizeIdentifier(alias)}` : '';
        
        this.selectClauses.push(`${sanitizedFn}(${sanitizedColumn})${sanitizedAlias}`);
        return this;
    }

    /**
     * Aggiunge una clausola COUNT alla query SELECT
     * @param {string} column - La colonna su cui applicare COUNT
     * @param {string} alias - L'alias per il risultato
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    count(column = '*', alias = 'count') {
        return this.aggregate('COUNT', column, alias);
    }

    /**
     * Aggiunge una clausola SUM alla query SELECT
     * @param {string} column - La colonna su cui applicare SUM
     * @param {string} alias - L'alias per il risultato
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    sum(column, alias) {
        return this.aggregate('SUM', column, alias);
    }

    /**
     * Aggiunge una clausola AVG alla query SELECT
     * @param {string} column - La colonna su cui applicare AVG
     * @param {string} alias - L'alias per il risultato
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    avg(column, alias) {
        return this.aggregate('AVG', column, alias);
    }

    /**
     * Aggiunge una clausola MIN alla query SELECT
     * @param {string} column - La colonna su cui applicare MIN
     * @param {string} alias - L'alias per il risultato
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    min(column, alias) {
        return this.aggregate('MIN', column, alias);
    }

    /**
     * Aggiunge una clausola MAX alla query SELECT
     * @param {string} column - La colonna su cui applicare MAX
     * @param {string} alias - L'alias per il risultato
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    max(column, alias) {
        return this.aggregate('MAX', column, alias);
    }

    /**
     * Imposta la query come INSERT
     * @param {Object} values - I valori da inserire
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    insert(values) {
        this.queryType = 'insert';
        this.insertValues = values;
        return this;
    }

    /**
     * Imposta la query come UPDATE
     * @param {Object} values - I valori da aggiornare
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    update(values) {
        this.queryType = 'update';
        this.updateValues = values;
        return this;
    }

    /**
     * Imposta la query come DELETE
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    delete() {
        this.queryType = 'delete';
        return this;
    }

    /**
     * Aggiunge una clausola WHERE alla query
     * @param {string} column - La colonna
     * @param {string} operator - L'operatore (=, !=, >, <, >=, <=, LIKE, IN, NOT IN)
     * @param {any} value - Il valore
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    where(column, operator, value) {
        // Sanitizza il nome della colonna
        const sanitizedColumn = this.sanitizeIdentifier(column);
        
        // Sanitizza l'operatore
        const sanitizedOperator = this.sanitizeOperator(operator);
        
        // Gestisci gli operatori speciali
        if (sanitizedOperator === 'IN' || sanitizedOperator === 'NOT IN') {
            if (!Array.isArray(value)) {
                throw new Error(`L'operatore ${sanitizedOperator} richiede un array come valore`);
            }
            
            const placeholders = value.map(() => '?').join(', ');
            this.whereClauses.push(`${sanitizedColumn} ${sanitizedOperator} (${placeholders})`);
            this.params.push(...value);
        } else if (value === null && (sanitizedOperator === '=' || sanitizedOperator === '!=')) {
            // Gestisci IS NULL e IS NOT NULL
            const nullOperator = sanitizedOperator === '=' ? 'IS NULL' : 'IS NOT NULL';
            this.whereClauses.push(`${sanitizedColumn} ${nullOperator}`);
        } else {
            // Caso standard
            this.whereClauses.push(`${sanitizedColumn} ${sanitizedOperator} ?`);
            this.params.push(value);
        }
        
        return this;
    }

    /**
     * Aggiunge una clausola WHERE con operatore =
     * @param {string} column - La colonna
     * @param {any} value - Il valore
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereEquals(column, value) {
        return this.where(column, '=', value);
    }

    /**
     * Aggiunge una clausola WHERE con operatore !=
     * @param {string} column - La colonna
     * @param {any} value - Il valore
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereNotEquals(column, value) {
        return this.where(column, '!=', value);
    }

    /**
     * Aggiunge una clausola WHERE con operatore >
     * @param {string} column - La colonna
     * @param {any} value - Il valore
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereGreaterThan(column, value) {
        return this.where(column, '>', value);
    }

    /**
     * Aggiunge una clausola WHERE con operatore <
     * @param {string} column - La colonna
     * @param {any} value - Il valore
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereLessThan(column, value) {
        return this.where(column, '<', value);
    }

    /**
     * Aggiunge una clausola WHERE con operatore >=
     * @param {string} column - La colonna
     * @param {any} value - Il valore
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereGreaterThanOrEqual(column, value) {
        return this.where(column, '>=', value);
    }

    /**
     * Aggiunge una clausola WHERE con operatore <=
     * @param {string} column - La colonna
     * @param {any} value - Il valore
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereLessThanOrEqual(column, value) {
        return this.where(column, '<=', value);
    }

    /**
     * Aggiunge una clausola WHERE con operatore LIKE
     * @param {string} column - La colonna
     * @param {string} pattern - Il pattern per LIKE
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereLike(column, pattern) {
        return this.where(column, 'LIKE', pattern);
    }

    /**
     * Aggiunge una clausola WHERE con operatore IN
     * @param {string} column - La colonna
     * @param {Array} values - I valori per IN
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereIn(column, values) {
        return this.where(column, 'IN', values);
    }

    /**
     * Aggiunge una clausola WHERE con operatore NOT IN
     * @param {string} column - La colonna
     * @param {Array} values - I valori per NOT IN
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereNotIn(column, values) {
        return this.where(column, 'NOT IN', values);
    }

    /**
     * Aggiunge una clausola WHERE con operatore IS NULL
     * @param {string} column - La colonna
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereNull(column) {
        return this.where(column, '=', null);
    }

    /**
     * Aggiunge una clausola WHERE con operatore IS NOT NULL
     * @param {string} column - La colonna
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereNotNull(column) {
        return this.where(column, '!=', null);
    }

    /**
     * Aggiunge una clausola WHERE con operatore BETWEEN
     * @param {string} column - La colonna
     * @param {any} min - Il valore minimo
     * @param {any} max - Il valore massimo
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereBetween(column, min, max) {
        const sanitizedColumn = this.sanitizeIdentifier(column);
        this.whereClauses.push(`${sanitizedColumn} BETWEEN ? AND ?`);
        this.params.push(min, max);
        return this;
    }

    /**
     * Aggiunge una clausola WHERE con operatore NOT BETWEEN
     * @param {string} column - La colonna
     * @param {any} min - Il valore minimo
     * @param {any} max - Il valore massimo
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereNotBetween(column, min, max) {
        const sanitizedColumn = this.sanitizeIdentifier(column);
        this.whereClauses.push(`${sanitizedColumn} NOT BETWEEN ? AND ?`);
        this.params.push(min, max);
        return this;
    }

    /**
     * Aggiunge una clausola WHERE con operatore AND
     * @param {Function} callback - La funzione di callback che riceve un'istanza di QueryBuilder
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereAnd(callback) {
        const subQuery = new QueryBuilder(this.table);
        callback(subQuery);
        
        if (subQuery.whereClauses.length > 0) {
            const subWhere = subQuery.whereClauses.join(' AND ');
            this.whereClauses.push(`(${subWhere})`);
            this.params.push(...subQuery.params);
        }
        
        return this;
    }

    /**
     * Aggiunge una clausola WHERE con operatore OR
     * @param {Function} callback - La funzione di callback che riceve un'istanza di QueryBuilder
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    whereOr(callback) {
        const subQuery = new QueryBuilder(this.table);
        callback(subQuery);
        
        if (subQuery.whereClauses.length > 0) {
            const subWhere = subQuery.whereClauses.join(' OR ');
            this.whereClauses.push(`(${subWhere})`);
            this.params.push(...subQuery.params);
        }
        
        return this;
    }

    /**
     * Aggiunge una clausola JOIN alla query
     * @param {string} table - La tabella da unire
     * @param {string} column1 - La colonna della tabella principale
     * @param {string} operator - L'operatore (=, !=, >, <, >=, <=)
     * @param {string} column2 - La colonna della tabella da unire
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    join(table, column1, operator, column2) {
        return this._join('INNER JOIN', table, column1, operator, column2);
    }

    /**
     * Aggiunge una clausola LEFT JOIN alla query
     * @param {string} table - La tabella da unire
     * @param {string} column1 - La colonna della tabella principale
     * @param {string} operator - L'operatore (=, !=, >, <, >=, <=)
     * @param {string} column2 - La colonna della tabella da unire
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    leftJoin(table, column1, operator, column2) {
        return this._join('LEFT JOIN', table, column1, operator, column2);
    }

    /**
     * Aggiunge una clausola RIGHT JOIN alla query
     * @param {string} table - La tabella da unire
     * @param {string} column1 - La colonna della tabella principale
     * @param {string} operator - L'operatore (=, !=, >, <, >=, <=)
     * @param {string} column2 - La colonna della tabella da unire
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    rightJoin(table, column1, operator, column2) {
        return this._join('RIGHT JOIN', table, column1, operator, column2);
    }

    /**
     * Aggiunge una clausola FULL JOIN alla query
     * @param {string} table - La tabella da unire
     * @param {string} column1 - La colonna della tabella principale
     * @param {string} operator - L'operatore (=, !=, >, <, >=, <=)
     * @param {string} column2 - La colonna della tabella da unire
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    fullJoin(table, column1, operator, column2) {
        return this._join('FULL JOIN', table, column1, operator, column2);
    }

    /**
     * Implementazione interna per le clausole JOIN
     * @param {string} type - Il tipo di JOIN
     * @param {string} table - La tabella da unire
     * @param {string} column1 - La colonna della tabella principale
     * @param {string} operator - L'operatore (=, !=, >, <, >=, <=)
     * @param {string} column2 - La colonna della tabella da unire
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    _join(type, table, column1, operator, column2) {
        const sanitizedTable = this.sanitizeIdentifier(table);
        const sanitizedColumn1 = this.sanitizeIdentifier(column1);
        const sanitizedOperator = this.sanitizeOperator(operator);
        const sanitizedColumn2 = this.sanitizeIdentifier(column2);
        
        this.joinClauses.push(`${type} ${sanitizedTable} ON ${sanitizedColumn1} ${sanitizedOperator} ${sanitizedColumn2}`);
        return this;
    }

    /**
     * Aggiunge una clausola ORDER BY alla query
     * @param {string} column - La colonna
     * @param {string} direction - La direzione (ASC o DESC)
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    orderBy(column, direction = 'ASC') {
        const sanitizedColumn = this.sanitizeIdentifier(column);
        const sanitizedDirection = direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        
        this.orderByClauses.push(`${sanitizedColumn} ${sanitizedDirection}`);
        return this;
    }

    /**
     * Aggiunge una clausola ORDER BY ASC alla query
     * @param {string} column - La colonna
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    orderByAsc(column) {
        return this.orderBy(column, 'ASC');
    }

    /**
     * Aggiunge una clausola ORDER BY DESC alla query
     * @param {string} column - La colonna
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    orderByDesc(column) {
        return this.orderBy(column, 'DESC');
    }

    /**
     * Aggiunge una clausola GROUP BY alla query
     * @param {...string} columns - Le colonne
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    groupBy(...columns) {
        const sanitizedColumns = columns.map(column => this.sanitizeIdentifier(column));
        this.groupByClauses.push(...sanitizedColumns);
        return this;
    }

    /**
     * Aggiunge una clausola HAVING alla query
     * @param {string} column - La colonna
     * @param {string} operator - L'operatore (=, !=, >, <, >=, <=, LIKE)
     * @param {any} value - Il valore
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    having(column, operator, value) {
        const sanitizedColumn = this.sanitizeIdentifier(column);
        const sanitizedOperator = this.sanitizeOperator(operator);
        
        this.havingClauses.push(`${sanitizedColumn} ${sanitizedOperator} ?`);
        this.params.push(value);
        return this;
    }

    /**
     * Aggiunge una clausola LIMIT alla query
     * @param {number} limit - Il limite
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    limit(limit) {
        this.limitValue = parseInt(limit, 10);
        return this;
    }

    /**
     * Aggiunge una clausola OFFSET alla query
     * @param {number} offset - L'offset
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    offset(offset) {
        this.offsetValue = parseInt(offset, 10);
        return this;
    }

    /**
     * Aggiunge clausole LIMIT e OFFSET per la paginazione
     * @param {number} page - Il numero di pagina (1-based)
     * @param {number} perPage - Il numero di elementi per pagina
     * @returns {QueryBuilder} L'istanza corrente per il chaining
     */
    paginate(page, perPage) {
        const currentPage = Math.max(1, parseInt(page, 10));
        const itemsPerPage = Math.max(1, parseInt(perPage, 10));
        
        this.limit(itemsPerPage);
        this.offset((currentPage - 1) * itemsPerPage);
        return this;
    }

    /**
     * Costruisce la query SQL
     * @returns {Object} La query SQL e i parametri
     */
    build() {
        let sql = '';
        const params = [...this.params];
        
        switch (this.queryType) {
            case 'select':
                sql = this._buildSelectQuery();
                break;
            case 'insert':
                sql = this._buildInsertQuery();
                break;
            case 'update':
                sql = this._buildUpdateQuery();
                break;
            case 'delete':
                sql = this._buildDeleteQuery();
                break;
            default:
                throw new Error(`Tipo di query non supportato: ${this.queryType}`);
        }
        
        return { sql, params };
    }

    /**
     * Costruisce una query SELECT
     * @returns {string} La query SQL
     */
    _buildSelectQuery() {
        const distinctClause = this.distinct ? 'DISTINCT ' : '';
        const selectClause = this.selectClauses.length > 0 ? this.selectClauses.join(', ') : '*';
        const sanitizedTable = this.sanitizeIdentifier(this.table);
        
        let sql = `SELECT ${distinctClause}${selectClause} FROM ${sanitizedTable}`;
        
        // Aggiungi le clausole JOIN
        if (this.joinClauses.length > 0) {
            sql += ` ${this.joinClauses.join(' ')}`;
        }
        
        // Aggiungi le clausole WHERE
        if (this.whereClauses.length > 0) {
            sql += ` WHERE ${this.whereClauses.join(' AND ')}`;
        }
        
        // Aggiungi le clausole GROUP BY
        if (this.groupByClauses.length > 0) {
            sql += ` GROUP BY ${this.groupByClauses.join(', ')}`;
        }
        
        // Aggiungi le clausole HAVING
        if (this.havingClauses.length > 0) {
            sql += ` HAVING ${this.havingClauses.join(' AND ')}`;
        }
        
        // Aggiungi le clausole ORDER BY
        if (this.orderByClauses.length > 0) {
            sql += ` ORDER BY ${this.orderByClauses.join(', ')}`;
        }
        
        // Aggiungi la clausola LIMIT
        if (this.limitValue !== null) {
            sql += ` LIMIT ${this.limitValue}`;
        }
        
        // Aggiungi la clausola OFFSET
        if (this.offsetValue !== null) {
            sql += ` OFFSET ${this.offsetValue}`;
        }
        
        return sql;
    }

    /**
     * Costruisce una query INSERT
     * @returns {string} La query SQL
     */
    _buildInsertQuery() {
        const sanitizedTable = this.sanitizeIdentifier(this.table);
        const columns = Object.keys(this.insertValues);
        const sanitizedColumns = columns.map(column => this.sanitizeIdentifier(column));
        const placeholders = columns.map(() => '?').join(', ');
        
        // Aggiungi i valori ai parametri
        columns.forEach(column => {
            this.params.push(this.insertValues[column]);
        });
        
        return `INSERT INTO ${sanitizedTable} (${sanitizedColumns.join(', ')}) VALUES (${placeholders})`;
    }

    /**
     * Costruisce una query UPDATE
     * @returns {string} La query SQL
     */
    _buildUpdateQuery() {
        const sanitizedTable = this.sanitizeIdentifier(this.table);
        const columns = Object.keys(this.updateValues);
        const sanitizedColumns = columns.map(column => this.sanitizeIdentifier(column));
        const setClauses = sanitizedColumns.map(column => `${column} = ?`).join(', ');
        
        // Aggiungi i valori ai parametri
        columns.forEach(column => {
            this.params.unshift(this.updateValues[column]);
        });
        
        let sql = `UPDATE ${sanitizedTable} SET ${setClauses}`;
        
        // Aggiungi le clausole WHERE
        if (this.whereClauses.length > 0) {
            sql += ` WHERE ${this.whereClauses.join(' AND ')}`;
        }
        
        return sql;
    }

    /**
     * Costruisce una query DELETE
     * @returns {string} La query SQL
     */
    _buildDeleteQuery() {
        const sanitizedTable = this.sanitizeIdentifier(this.table);
        
        let sql = `DELETE FROM ${sanitizedTable}`;
        
        // Aggiungi le clausole WHERE
        if (this.whereClauses.length > 0) {
            sql += ` WHERE ${this.whereClauses.join(' AND ')}`;
        }
        
        return sql;
    }

    /**
     * Sanitizza un identificatore SQL (tabella o colonna)
     * @param {string} identifier - L'identificatore da sanitizzare
     * @returns {string} L'identificatore sanitizzato
     */
    sanitizeIdentifier(identifier) {
        // Gestisci il caso di colonne con alias (es. "table.column AS alias")
        if (identifier.includes(' AS ')) {
            const parts = identifier.split(' AS ');
            const sanitizedColumn = this.sanitizeIdentifier(parts[0]);
            const sanitizedAlias = this.sanitizeIdentifier(parts[1]);
            return `${sanitizedColumn} AS ${sanitizedAlias}`;
        }
        
        // Gestisci il caso di colonne con tabella (es. "table.column")
        if (identifier.includes('.')) {
            const parts = identifier.split('.');
            const sanitizedTable = this.sanitizeIdentifier(parts[0]);
            const sanitizedColumn = this.sanitizeIdentifier(parts[1]);
            return `${sanitizedTable}.${sanitizedColumn}`;
        }
        
        // Sanitizza l'identificatore
        // Rimuovi caratteri non validi e previeni SQL injection
        const sanitized = identifier.replace(/[^\w\d_]/g, '');
        
        // Se l'identificatore è stato modificato, lancia un errore
        if (sanitized !== identifier) {
            throw new Error(`Identificatore non valido: ${identifier}`);
        }
        
        return identifier;
    }

    /**
     * Sanitizza un operatore SQL
     * @param {string} operator - L'operatore da sanitizzare
     * @returns {string} L'operatore sanitizzato
     */
    sanitizeOperator(operator) {
        const validOperators = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'NOT IN', 'BETWEEN', 'NOT BETWEEN'];
        const upperOperator = operator.toUpperCase();
        
        // Verifica se l'operatore è valido
        if (!validOperators.includes(upperOperator) && !validOperators.includes(operator)) {
            throw new Error(`Operatore non valido: ${operator}`);
        }
        
        return upperOperator === 'LIKE' || upperOperator === 'IN' || upperOperator === 'NOT IN' || 
               upperOperator === 'BETWEEN' || upperOperator === 'NOT BETWEEN' ? 
               upperOperator : operator;
    }
}

module.exports = QueryBuilder;
