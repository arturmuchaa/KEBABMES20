"""Additive label history DDL. No destructive rollback; retain audit records.

Installed atomically by the existing migration runner. Legacy tables remain the
editable head. Triggers capture writes by both old and new application versions.
The scope is explicitly single-company until MES has trusted tenant identity.
"""

DDL = [
    """CREATE TABLE IF NOT EXISTS label_template_revisions (
        id BIGSERIAL PRIMARY KEY,
        scope_key TEXT NOT NULL DEFAULT 'legacy-single-company',
        source TEXT NOT NULL CHECK (source IN ('label_templates','zebra_label_designs')),
        template_id TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK (revision > 0),
        operation TEXT NOT NULL CHECK (operation IN ('baseline','insert','update','delete')),
        document JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(scope_key, source, template_id, revision)
    )""",
    """CREATE OR REPLACE FUNCTION mes_capture_label_revision() RETURNS trigger AS $$
    DECLARE previous_document JSONB; next_document JSONB; next_revision INTEGER;
    BEGIN
      IF TG_OP <> 'INSERT' THEN
        previous_document := to_jsonb(OLD) - 'updated_at' - 'created_at';
        INSERT INTO label_template_revisions(source,template_id,revision,operation,document)
          VALUES(TG_TABLE_NAME,OLD.id,1,'baseline',previous_document)
          ON CONFLICT(scope_key,source,template_id,revision) DO NOTHING;
      END IF;
      IF TG_OP = 'DELETE' THEN next_document := previous_document;
      ELSE next_document := to_jsonb(NEW) - 'updated_at' - 'created_at'; END IF;
      IF TG_OP = 'UPDATE' AND previous_document = next_document THEN RETURN NEW; END IF;
      SELECT COALESCE(MAX(revision),0)+1 INTO next_revision
        FROM label_template_revisions WHERE scope_key='legacy-single-company'
          AND source=TG_TABLE_NAME AND template_id=next_document->>'id';
      INSERT INTO label_template_revisions(source,template_id,revision,operation,document)
        VALUES(TG_TABLE_NAME,next_document->>'id',next_revision,lower(TG_OP),next_document);
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql""",
    *[
        f"""DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='mes_label_revision_{table}'
            AND tgrelid='{table}'::regclass) THEN
            CREATE TRIGGER mes_label_revision_{table} AFTER INSERT OR UPDATE OR DELETE ON {table}
              FOR EACH ROW EXECUTE FUNCTION mes_capture_label_revision();
          END IF;
        END $$""" for table in ('label_templates', 'zebra_label_designs')
    ],
    *[
        f"""INSERT INTO label_template_revisions(source,template_id,revision,operation,document)
          SELECT '{table}',t.id,1,'baseline',to_jsonb(t)-'updated_at'-'created_at' FROM {table} t
          ON CONFLICT(scope_key,source,template_id,revision) DO NOTHING"""
        for table in ('label_templates', 'zebra_label_designs')
    ],
    """CREATE TABLE IF NOT EXISTS label_print_jobs (
        id TEXT PRIMARY KEY,
        scope_key TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        revision_id BIGINT NOT NULL REFERENCES label_template_revisions(id),
        source_job_id TEXT REFERENCES label_print_jobs(id),
        plan_line_id TEXT NOT NULL,
        language TEXT NOT NULL CHECK(language IN ('zpl','a4')),
        printer_name TEXT NOT NULL,
        printer_uid TEXT NOT NULL,
        transport TEXT NOT NULL CHECK(transport IN ('browserprint','file','browser')),
        state TEXT NOT NULL DEFAULT 'prepared'
          CHECK(state IN ('prepared','submitting','submitted','exported','dialog_opened','uncertain','cancelled')),
        render_context JSONB NOT NULL DEFAULT '{}',
        attempt_token TEXT,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(scope_key,idempotency_key)
    )""",
    "ALTER TABLE label_print_jobs ADD COLUMN IF NOT EXISTS render_context JSONB NOT NULL DEFAULT '{}'",
    # Widen CHECK domains atomically, without deleting or rewriting any jobs.
    *[
        f"""DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='label_print_jobs'::regclass
            AND conname='label_print_jobs_{column}_check' AND strpos(pg_get_constraintdef(oid), $needle${marker}$needle$)>0) THEN
            ALTER TABLE label_print_jobs DROP CONSTRAINT IF EXISTS label_print_jobs_{column}_check;
            ALTER TABLE label_print_jobs ADD CONSTRAINT label_print_jobs_{column}_check CHECK ({column} IN ({values}));
          END IF;
        END $$""" for column, marker, values in (
            ('language', 'a4', "'zpl','a4'"),
            ('transport', "'browser'", "'browserprint','file','browser'"),
            ('state', 'dialog_opened', "'prepared','submitting','submitted','exported','dialog_opened','uncertain','cancelled'"),
        )
    ],
    """CREATE TABLE IF NOT EXISTS label_print_job_items (
        job_id TEXT NOT NULL REFERENCES label_print_jobs(id),
        ordinal INTEGER NOT NULL,
        unit_id TEXT NOT NULL,
        unit_snapshot JSONB NOT NULL,
        recipe_snapshot JSONB NOT NULL,
        payload_zlib BYTEA NOT NULL,
        payload_sha256 TEXT NOT NULL,
        PRIMARY KEY(job_id,ordinal), UNIQUE(job_id,unit_id)
    )""",
    "CREATE INDEX IF NOT EXISTS idx_label_job_unit ON label_print_job_items(unit_id,job_id)",
    """CREATE TABLE IF NOT EXISTS label_print_events (
        id BIGSERIAL PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES label_print_jobs(id),
        state TEXT NOT NULL,
        actor TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""",
    """CREATE OR REPLACE FUNCTION mes_label_immutable() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'Label history is append-only'; END; $$ LANGUAGE plpgsql""",
    *[
        f"""DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='mes_label_immutable_{table}'
            AND tgrelid='{table}'::regclass) THEN
            CREATE TRIGGER mes_label_immutable_{table} BEFORE UPDATE OR DELETE ON {table}
              FOR EACH ROW EXECUTE FUNCTION mes_label_immutable();
          END IF;
        END $$""" for table in ('label_template_revisions', 'label_print_job_items', 'label_print_events')
    ],
    """CREATE OR REPLACE FUNCTION mes_label_job_guard() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Label jobs cannot be deleted'; END IF;
      IF (to_jsonb(NEW)-'state'-'attempt_token'-'updated_at') IS DISTINCT FROM
         (to_jsonb(OLD)-'state'-'attempt_token'-'updated_at') THEN
        RAISE EXCEPTION 'Label job metadata is immutable';
      END IF;
      IF NOT ((OLD.state='prepared' AND NEW.state IN ('submitting','cancelled')) OR
              (OLD.state='submitting' AND NEW.state IN ('submitted','exported','dialog_opened','uncertain'))) THEN
        RAISE EXCEPTION 'Invalid label job state transition';
      END IF;
      IF (NEW.state='submitted' AND NEW.transport<>'browserprint') OR
         (NEW.state='dialog_opened' AND NEW.transport<>'browser') OR
         (NEW.state='exported' AND NEW.transport<>'file') OR
         (NEW.state='submitting' AND COALESCE(NEW.attempt_token,'')='') THEN
        RAISE EXCEPTION 'Invalid label transport acknowledgement';
      END IF;
      IF OLD.state='submitting' AND NEW.attempt_token IS DISTINCT FROM OLD.attempt_token THEN
        RAISE EXCEPTION 'Label attempt token is immutable';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql""",
    """DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='mes_label_job_guard'
        AND tgrelid='label_print_jobs'::regclass) THEN
        CREATE TRIGGER mes_label_job_guard BEFORE UPDATE OR DELETE ON label_print_jobs
          FOR EACH ROW EXECUTE FUNCTION mes_label_job_guard();
      END IF;
    END $$""",
]
