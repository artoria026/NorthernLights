"""initial schema (consolidada para el deploy inicial de produccion)

Reemplaza toda la cadena anterior de migraciones incrementales (M00-M11:
core/auth, accounts, categories, transacciones, deudas, recurrentes/budget,
notificaciones, insights, chat del asesor, reportes, RLS forzado y rol de
reporting de Admin). Igual que el squash que ya se habia hecho una vez para
las categorias (ver comentario del seed mas abajo), esto consolida el
schema final validado -- generado por pg_dump contra una base ya migrada a
head y con el suite de tests completo en verde -- en una sola migracion
base. Un deploy nuevo no tiene datos viejos que migrar, asi que cargar 19
migraciones incrementales solo para llegar al mismo estado final no aporta
nada y hace mas lento cualquier `alembic upgrade head` desde cero.

Un solo fix real respecto al estado que tenian las migraciones viejas:
`user_preferences` nunca tuvo RLS (bug de omision -- la tabla si tiene
`user_id` y datos por usuario, pero se quedo fuera de la lista de
9308135f291c "force row level security"). Se agrega aqui ENABLE + FORCE +
policy, igual que el resto de las tablas con datos de usuario.

Revision ID: 293528f67338
Revises:
Create Date: 2026-08-10 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "293528f67338"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ADMIN_ROLE_NAME = "finanzas_admin"


def upgrade() -> None:
    op.execute(
        """
        CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public
        """
    )

    op.execute(
        """
        CREATE FUNCTION set_updated_at() RETURNS trigger
            LANGUAGE plpgsql
            AS $$
                BEGIN
                    NEW.updated_at = NOW();
                    RETURN NEW;
                END;
                $$
        """
    )

    op.execute(
        """
        CREATE TABLE accounts (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            name text NOT NULL,
            type text NOT NULL,
            subtype text,
            last_4_digits character(4),
            currency text DEFAULT 'MXN'::text NOT NULL,
            color text DEFAULT '#6366F1'::text NOT NULL,
            notes text,
            balance numeric(15,2) DEFAULT 0 NOT NULL,
            initial_balance numeric(15,2) DEFAULT 0 NOT NULL,
            is_active boolean DEFAULT true NOT NULL,
            credit_limit numeric(15,2),
            interest_rate numeric(6,4),
            billing_cycle_day integer,
            payment_due_day integer,
            client_id uuid,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            deleted_at timestamp with time zone,
            logo_data_url text,
            is_internal boolean DEFAULT false NOT NULL,
            CONSTRAINT accounts_billing_cycle_day_check CHECK (((billing_cycle_day >= 1) AND (billing_cycle_day <= 31))),
            CONSTRAINT accounts_payment_due_day_check CHECK (((payment_due_day >= 1) AND (payment_due_day <= 31))),
            CONSTRAINT accounts_subtype_check CHECK ((subtype = ANY (ARRAY['cash'::text, 'checking'::text, 'savings'::text, 'credit_card'::text, 'payroll_loan'::text, 'personal_loan'::text, 'store_credit'::text, 'informal_debt'::text, 'loan_payable'::text, 'loan_receivable'::text, 'installment'::text, 'civic'::text]))),
            CONSTRAINT accounts_type_check CHECK ((type = ANY (ARRAY['asset'::text, 'liability'::text, 'income'::text, 'expense'::text, 'equity'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY accounts FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE budget_limits (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            category_id uuid NOT NULL,
            monthly_limit numeric(15,2) NOT NULL,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT budget_limits_monthly_limit_check CHECK ((monthly_limit >= (0)::numeric))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY budget_limits FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE budget_periods (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            category_id uuid NOT NULL,
            year integer NOT NULL,
            month integer NOT NULL,
            budgeted numeric(15,2) DEFAULT 0 NOT NULL,
            spent numeric(15,2) DEFAULT 0 NOT NULL,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT budget_periods_month_check CHECK (((month >= 1) AND (month <= 12)))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY budget_periods FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE categories (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid,
            name text NOT NULL,
            type text NOT NULL,
            icon text,
            color text DEFAULT '#6366F1'::text NOT NULL,
            is_system boolean DEFAULT false NOT NULL,
            is_active boolean DEFAULT true NOT NULL,
            sort_order integer DEFAULT 0 NOT NULL,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            deleted_at timestamp with time zone,
            parent_id uuid,
            CONSTRAINT categories_type_check CHECK ((type = ANY (ARRAY['income'::text, 'expense'::text]))),
            CONSTRAINT ck_categories_subcategory_user_scoped
                CHECK (parent_id IS NULL OR user_id IS NOT NULL)
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY categories FORCE ROW LEVEL SECURITY
        """
    )

    # -- category_hides: desactivacion de una categoria de sistema a nivel
    # usuario (nunca se toca la fila global de `categories`, que es
    # compartida por todos). Sin fila aqui = visible; con fila = oculta para
    # ese usuario, reversible borrando la fila. Solo aplica a categorias de
    # sistema -- las propias del usuario se eliminan (soft-delete), no se
    # ocultan.
    op.execute(
        """
        CREATE TABLE category_hides (
            user_id uuid NOT NULL,
            category_id uuid NOT NULL,
            hidden_at timestamp with time zone DEFAULT now() NOT NULL
        )
        """
    )
    op.execute(
        """
        ALTER TABLE ONLY category_hides
            ADD CONSTRAINT category_hides_pkey PRIMARY KEY (user_id, category_id)
        """
    )
    op.execute(
        """
        ALTER TABLE ONLY category_hides FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE chat_messages (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            role text NOT NULL,
            content text NOT NULL,
            tool_calls jsonb,
            tokens_used integer,
            ai_provider text,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY chat_messages FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE debt_payments (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            debt_id uuid NOT NULL,
            user_id uuid NOT NULL,
            amount numeric(15,2) NOT NULL,
            date date NOT NULL,
            payment_number integer,
            journal_entry_id uuid,
            notes text,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT debt_payments_amount_check CHECK ((amount > (0)::numeric))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY debt_payments FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE debts (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            unplanned_debt_id uuid,
            name text NOT NULL,
            creditor text,
            type text NOT NULL,
            original_amount numeric(15,2),
            agreed_amount numeric(15,2),
            total_amount numeric(15,2) NOT NULL,
            current_balance numeric(15,2) NOT NULL,
            interest_rate numeric(6,4) DEFAULT 0 NOT NULL,
            payment_amount numeric(15,2),
            payment_frequency text,
            payment_day integer,
            total_installments integer,
            paid_installments integer DEFAULT 0 NOT NULL,
            status text DEFAULT 'active'::text NOT NULL,
            linked_account_id uuid,
            start_date date,
            estimated_end_date date,
            next_payment_date date,
            due_date date,
            is_shared boolean DEFAULT false NOT NULL,
            responsible_party text,
            notes text,
            client_id uuid,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            deleted_at timestamp with time zone,
            direction text DEFAULT 'owed_by_me'::text NOT NULL,
            payment_source_account_id uuid,
            CONSTRAINT ck_debts_direction CHECK ((direction = ANY (ARRAY['owed_by_me'::text, 'owed_to_me'::text]))),
            CONSTRAINT debts_payment_frequency_check CHECK (((payment_frequency IS NULL) OR (payment_frequency = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, 'irregular'::text])))),
            CONSTRAINT debts_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'negotiating'::text]))),
            CONSTRAINT debts_type_check CHECK ((type = ANY (ARRAY['credit_card'::text, 'personal_loan'::text, 'payroll_loan'::text, 'installment'::text, 'informal'::text, 'civic'::text, 'loan_received'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY debts FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE devices (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            device_name text,
            device_type text NOT NULL,
            push_token text,
            refresh_token text,
            refresh_token_expires_at timestamp with time zone,
            last_used_at timestamp with time zone,
            last_sync_at timestamp with time zone,
            is_active boolean DEFAULT true NOT NULL,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT devices_device_type_check CHECK ((device_type = ANY (ARRAY['web'::text, 'ios'::text, 'android'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY devices FORCE ROW LEVEL SECURITY
        """
    )

    # -- feedback: reportes de bug / sugerencias de feature, mandados desde
    # el modal de novedades (ver ChangelogButton.tsx). RLS con una clausula
    # extra respecto al patron usual (user_id = current_user): un admin ve y
    # puede actualizar el status de CUALQUIER fila, no solo la propia -- sin
    # esto, el panel de Admin necesitaria el rol finanzas_admin (solo
    # SELECT, no serviria para cambiar el status).
    op.execute(
        """
        CREATE TABLE feedback (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            type text NOT NULL,
            message text NOT NULL,
            status text DEFAULT 'new'::text NOT NULL,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT feedback_pkey PRIMARY KEY (id),
            CONSTRAINT ck_feedback_type CHECK ((type = ANY (ARRAY['bug'::text, 'feature'::text]))),
            CONSTRAINT ck_feedback_status
                CHECK ((status = ANY (ARRAY['new'::text, 'read'::text, 'considered'::text, 'discarded'::text])))
        )
        """
    )
    op.execute(
        "CREATE INDEX idx_feedback_status ON feedback USING btree (status, created_at DESC)"
    )
    op.execute(
        "CREATE TRIGGER trg_updated_at_feedback BEFORE UPDATE ON feedback "
        "FOR EACH ROW EXECUTE FUNCTION set_updated_at()"
    )
    op.execute("ALTER TABLE ONLY feedback FORCE ROW LEVEL SECURITY")

    op.execute(
        """
        CREATE TABLE insight_reviews (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            insight_id uuid NOT NULL,
            user_id uuid NOT NULL,
            reviewed_at timestamp with time zone DEFAULT now() NOT NULL,
            metrics jsonb NOT NULL,
            trend text NOT NULL,
            ai_assessment text NOT NULL,
            next_review_at date NOT NULL,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT insight_reviews_trend_check CHECK ((trend = ANY (ARRAY['improved'::text, 'worsened'::text, 'stable'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY insight_reviews FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE insights (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            title text NOT NULL,
            description text NOT NULL,
            category text NOT NULL,
            priority text DEFAULT 'medium'::text NOT NULL,
            generated_by text NOT NULL,
            ai_provider text NOT NULL,
            ai_context jsonb NOT NULL,
            metrics_at_creation jsonb NOT NULL,
            metrics_at_last_review jsonb,
            status text DEFAULT 'active'::text NOT NULL,
            review_frequency text DEFAULT 'monthly'::text NOT NULL,
            next_review_at date NOT NULL,
            last_reviewed_at timestamp with time zone,
            review_count integer DEFAULT 0 NOT NULL,
            dismissed_at timestamp with time zone,
            resolved_at timestamp with time zone,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            deleted_at timestamp with time zone,
            CONSTRAINT insights_category_check CHECK ((category = ANY (ARRAY['spending'::text, 'debt'::text, 'savings'::text, 'income'::text, 'budget'::text, 'general'::text]))),
            CONSTRAINT insights_generated_by_check CHECK ((generated_by = ANY (ARRAY['auto_celery'::text, 'user_chat'::text]))),
            CONSTRAINT insights_priority_check CHECK ((priority = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
            CONSTRAINT insights_review_frequency_check CHECK ((review_frequency = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text]))),
            CONSTRAINT insights_status_check CHECK ((status = ANY (ARRAY['active'::text, 'dismissed'::text, 'resolved'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY insights FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE journal_entries (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            date date NOT NULL,
            description text NOT NULL,
            notes text,
            tags text[] DEFAULT '{}'::text[],
            amount numeric(15,2),
            entry_type text NOT NULL,
            category_id uuid,
            status text DEFAULT 'confirmed'::text NOT NULL,
            is_recurring boolean DEFAULT false NOT NULL,
            recurring_id uuid,
            client_id uuid,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            deleted_at timestamp with time zone,
            debt_id uuid,
            CONSTRAINT journal_entries_entry_type_check CHECK ((entry_type = ANY (ARRAY['expense'::text, 'income'::text, 'transfer'::text, 'loan_received'::text, 'loan_repayment'::text, 'loan_given'::text, 'loan_collection'::text, 'adjustment_in'::text, 'adjustment_out'::text]))),
            CONSTRAINT journal_entries_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'pending'::text, 'confirmed'::text, 'rejected'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY journal_entries FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE journal_lines (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            entry_id uuid NOT NULL,
            account_id uuid NOT NULL,
            amount numeric(15,2) NOT NULL,
            type text NOT NULL,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT journal_lines_amount_check CHECK ((amount > (0)::numeric)),
            CONSTRAINT journal_lines_type_check CHECK ((type = ANY (ARRAY['debit'::text, 'credit'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY journal_lines FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE notifications (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            title text NOT NULL,
            body text,
            type text NOT NULL,
            is_read boolean DEFAULT false NOT NULL,
            read_at timestamp with time zone,
            action_url text,
            related_entity_type text,
            related_entity_id uuid,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT notifications_type_check CHECK ((type = ANY (ARRAY['report_ready'::text, 'insight_generated'::text, 'insight_reviewed'::text, 'debt_alert'::text, 'budget_alert'::text, 'tdc_due'::text, 'pending_payment'::text, 'pending_payment_reminder'::text, 'subscription_alert'::text, 'loan_overdue'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY notifications FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE recurring_items (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            name text NOT NULL,
            description text,
            item_type text DEFAULT 'subscription'::text NOT NULL,
            amount numeric(15,2) NOT NULL,
            frequency text NOT NULL,
            frequency_day integer,
            account_id uuid NOT NULL,
            contra_account_id uuid NOT NULL,
            category_id uuid NOT NULL,
            status text DEFAULT 'active'::text NOT NULL,
            cancelled_at date,
            alert_urgency text DEFAULT 'normal'::text NOT NULL,
            auto_generate boolean DEFAULT true NOT NULL,
            last_generated_at timestamp with time zone,
            next_date date NOT NULL,
            notes text,
            url text,
            client_id uuid,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            deleted_at timestamp with time zone,
            CONSTRAINT recurring_items_alert_urgency_check CHECK ((alert_urgency = ANY (ARRAY['normal'::text, 'high'::text, 'critical'::text]))),
            CONSTRAINT recurring_items_amount_check CHECK ((amount > (0)::numeric)),
            CONSTRAINT recurring_items_frequency_check CHECK ((frequency = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text, 'bimonthly'::text, 'annual'::text]))),
            CONSTRAINT recurring_items_item_type_check CHECK ((item_type = ANY (ARRAY['subscription'::text, 'service'::text, 'utility'::text, 'income'::text]))),
            CONSTRAINT recurring_items_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'cancelled'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY recurring_items FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE report_insights (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            report_id uuid NOT NULL,
            flow_type text NOT NULL,
            title text NOT NULL,
            description text NOT NULL,
            category_name text,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT report_insights_flow_type_check CHECK ((flow_type = ANY (ARRAY['income'::text, 'expense'::text, 'general'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY report_insights FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE reports (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            type text NOT NULL,
            period_start date NOT NULL,
            period_end date NOT NULL,
            status text DEFAULT 'generating'::text NOT NULL,
            summary jsonb,
            generated_by text NOT NULL,
            generated_at timestamp with time zone,
            error_message text,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            CONSTRAINT ck_reports_type CHECK ((type = ANY (ARRAY['monthly_auto'::text, 'monthly_manual'::text, 'yearly_auto'::text, 'yearly_manual'::text, 'custom'::text]))),
            CONSTRAINT reports_generated_by_check CHECK ((generated_by = ANY (ARRAY['auto'::text, 'user'::text]))),
            CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['generating'::text, 'ready'::text, 'error'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY reports FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE unplanned_debts (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            user_id uuid NOT NULL,
            name text NOT NULL,
            creditor text,
            amount numeric(15,2) NOT NULL,
            notes text,
            status text DEFAULT 'pending'::text NOT NULL,
            converted_to_debt_id uuid,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            deleted_at timestamp with time zone,
            direction text DEFAULT 'owed_by_me'::text NOT NULL,
            CONSTRAINT ck_unplanned_debts_direction CHECK ((direction = ANY (ARRAY['owed_by_me'::text, 'owed_to_me'::text]))),
            CONSTRAINT unplanned_debts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'converted'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY unplanned_debts FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE TABLE user_preferences (
            user_id uuid NOT NULL,
            theme character varying DEFAULT 'dark'::character varying NOT NULL,
            pay_cycle character varying DEFAULT 'monthly'::character varying NOT NULL,
            email_notifications boolean DEFAULT true NOT NULL,
            push_notifications boolean DEFAULT true NOT NULL,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            debt_trouble_mode boolean DEFAULT false NOT NULL,
            last_seen_changelog_version text,
            CONSTRAINT ck_user_preferences_pay_cycle CHECK (((pay_cycle)::text = ANY ((ARRAY['weekly'::character varying, 'biweekly'::character varying, 'monthly'::character varying])::text[]))),
            CONSTRAINT ck_user_preferences_theme CHECK (((theme)::text = ANY ((ARRAY['dark'::character varying, 'light'::character varying])::text[])))
        )
        """
    )

    op.execute(
        """
        CREATE TABLE users (
            id uuid DEFAULT gen_random_uuid() NOT NULL,
            email text NOT NULL,
            name text NOT NULL,
            password_hash text,
            role text DEFAULT 'user'::text NOT NULL,
            auth_provider text DEFAULT 'email'::text NOT NULL,
            google_id text,
            is_active boolean DEFAULT true NOT NULL,
            created_at timestamp with time zone DEFAULT now() NOT NULL,
            updated_at timestamp with time zone DEFAULT now() NOT NULL,
            deleted_at timestamp with time zone,
            avatar_url text,
            CONSTRAINT users_auth_provider_check CHECK ((auth_provider = ANY (ARRAY['email'::text, 'google'::text]))),
            CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'user'::text])))
        )
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY accounts
            ADD CONSTRAINT accounts_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY budget_limits
            ADD CONSTRAINT budget_limits_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY budget_limits
            ADD CONSTRAINT budget_limits_user_id_category_id_key UNIQUE (user_id, category_id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY budget_periods
            ADD CONSTRAINT budget_periods_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY budget_periods
            ADD CONSTRAINT budget_periods_user_id_category_id_year_month_key UNIQUE (user_id, category_id, year, month)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY categories
            ADD CONSTRAINT categories_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY chat_messages
            ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY debt_payments
            ADD CONSTRAINT debt_payments_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY debts
            ADD CONSTRAINT debts_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY devices
            ADD CONSTRAINT devices_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY devices
            ADD CONSTRAINT devices_refresh_token_key UNIQUE (refresh_token)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY insight_reviews
            ADD CONSTRAINT insight_reviews_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY insights
            ADD CONSTRAINT insights_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY journal_entries
            ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY journal_lines
            ADD CONSTRAINT journal_lines_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY notifications
            ADD CONSTRAINT notifications_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY recurring_items
            ADD CONSTRAINT recurring_items_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY report_insights
            ADD CONSTRAINT report_insights_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY reports
            ADD CONSTRAINT reports_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY unplanned_debts
            ADD CONSTRAINT unplanned_debts_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY user_preferences
            ADD CONSTRAINT user_preferences_pkey PRIMARY KEY (user_id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY users
            ADD CONSTRAINT users_email_key UNIQUE (email)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY users
            ADD CONSTRAINT users_google_id_key UNIQUE (google_id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY users
            ADD CONSTRAINT users_pkey PRIMARY KEY (id)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_accounts_user_active ON accounts USING btree (user_id) WHERE ((is_active = true) AND (deleted_at IS NULL))
        """
    )

    op.execute(
        """
        CREATE INDEX idx_accounts_user_type ON accounts USING btree (user_id, type) WHERE ((is_active = true) AND (deleted_at IS NULL))
        """
    )

    op.execute(
        """
        CREATE INDEX idx_budget_limits_user ON budget_limits USING btree (user_id)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_budget_periods_user_month ON budget_periods USING btree (user_id, year, month)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_categories_system ON categories USING btree (type, sort_order) WHERE ((user_id IS NULL) AND (is_active = true))
        """
    )

    op.execute(
        """
        CREATE INDEX idx_categories_user_type ON categories USING btree (user_id, type) WHERE ((is_active = true) AND (deleted_at IS NULL))
        """
    )

    op.execute(
        """
        CREATE INDEX idx_categories_parent ON categories USING btree (parent_id) WHERE (parent_id IS NOT NULL)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_chat_messages_user_date ON chat_messages USING btree (user_id, created_at DESC)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_debt_payments_debt ON debt_payments USING btree (debt_id)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_debt_payments_user_date ON debt_payments USING btree (user_id, date DESC)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_debts_upcoming ON debts USING btree (user_id, next_payment_date) WHERE ((status = 'active'::text) AND (next_payment_date IS NOT NULL) AND (deleted_at IS NULL))
        """
    )

    op.execute(
        """
        CREATE INDEX idx_debts_user_status ON debts USING btree (user_id, status) WHERE (deleted_at IS NULL)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_devices_user ON devices USING btree (user_id) WHERE (is_active = true)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_insight_reviews_insight ON insight_reviews USING btree (insight_id, reviewed_at)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_insights_review_due ON insights USING btree (next_review_at) WHERE ((status = 'active'::text) AND (deleted_at IS NULL))
        """
    )

    op.execute(
        """
        CREATE INDEX idx_insights_user_status ON insights USING btree (user_id, status) WHERE (deleted_at IS NULL)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_journal_entries_debt_pending ON journal_entries USING btree (debt_id) WHERE ((status = 'pending'::text) AND (deleted_at IS NULL))
        """
    )

    op.execute(
        """
        CREATE INDEX idx_journal_entries_user_confirmed ON journal_entries USING btree (user_id, date DESC) WHERE ((status = 'confirmed'::text) AND (deleted_at IS NULL))
        """
    )

    op.execute(
        """
        CREATE INDEX idx_journal_entries_user_draft ON journal_entries USING btree (user_id, created_at DESC) WHERE ((status = 'draft'::text) AND (deleted_at IS NULL))
        """
    )

    op.execute(
        """
        CREATE INDEX idx_journal_entries_user_type ON journal_entries USING btree (user_id, entry_type, date DESC) WHERE ((status = 'confirmed'::text) AND (deleted_at IS NULL))
        """
    )

    op.execute(
        """
        CREATE INDEX idx_journal_lines_account_type ON journal_lines USING btree (account_id, type)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_journal_lines_entry ON journal_lines USING btree (entry_id)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_notifications_user_all ON notifications USING btree (user_id, created_at)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_notifications_user_unread ON notifications USING btree (user_id, created_at) WHERE (is_read = false)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_recurring_next ON recurring_items USING btree (user_id, next_date) WHERE ((status = 'active'::text) AND (deleted_at IS NULL))
        """
    )

    op.execute(
        """
        CREATE INDEX idx_recurring_user_type ON recurring_items USING btree (user_id, item_type) WHERE ((status = 'active'::text) AND (deleted_at IS NULL))
        """
    )

    op.execute(
        """
        CREATE INDEX idx_report_insights_report ON report_insights USING btree (report_id)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_reports_user_date ON reports USING btree (user_id, period_start DESC)
        """
    )

    op.execute(
        """
        CREATE UNIQUE INDEX idx_reports_user_period ON reports USING btree (user_id, period_start, period_end, type)
        """
    )

    op.execute(
        """
        CREATE INDEX idx_unplanned_debts_user ON unplanned_debts USING btree (user_id) WHERE ((status = 'pending'::text) AND (deleted_at IS NULL))
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_updated_at_accounts BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_updated_at_budget_limits BEFORE UPDATE ON budget_limits FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_updated_at_budget_periods BEFORE UPDATE ON budget_periods FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_updated_at_categories BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_updated_at_debts BEFORE UPDATE ON debts FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_updated_at_devices BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_updated_at_journal_entries BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_updated_at_recurring_items BEFORE UPDATE ON recurring_items FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_updated_at_unplanned_debts BEFORE UPDATE ON unplanned_debts FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """
    )

    op.execute(
        """
        CREATE TRIGGER trg_updated_at_users BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY accounts
            ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY budget_limits
            ADD CONSTRAINT budget_limits_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY budget_limits
            ADD CONSTRAINT budget_limits_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY budget_periods
            ADD CONSTRAINT budget_periods_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY budget_periods
            ADD CONSTRAINT budget_periods_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY categories
            ADD CONSTRAINT categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY categories
            ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id)
                REFERENCES categories(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY chat_messages
            ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY debt_payments
            ADD CONSTRAINT debt_payments_debt_id_fkey FOREIGN KEY (debt_id) REFERENCES debts(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY debt_payments
            ADD CONSTRAINT debt_payments_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY debt_payments
            ADD CONSTRAINT debt_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY debts
            ADD CONSTRAINT debts_linked_account_id_fkey FOREIGN KEY (linked_account_id) REFERENCES accounts(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY debts
            ADD CONSTRAINT debts_payment_source_account_id_fkey FOREIGN KEY (payment_source_account_id) REFERENCES accounts(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY debts
            ADD CONSTRAINT debts_unplanned_debt_id_fkey FOREIGN KEY (unplanned_debt_id) REFERENCES unplanned_debts(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY debts
            ADD CONSTRAINT debts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY devices
            ADD CONSTRAINT devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY journal_entries
            ADD CONSTRAINT fk_journal_entries_recurring FOREIGN KEY (recurring_id) REFERENCES recurring_items(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY unplanned_debts
            ADD CONSTRAINT fk_unplanned_debts_converted_to_debt FOREIGN KEY (converted_to_debt_id) REFERENCES debts(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY insight_reviews
            ADD CONSTRAINT insight_reviews_insight_id_fkey FOREIGN KEY (insight_id) REFERENCES insights(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY insight_reviews
            ADD CONSTRAINT insight_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY insights
            ADD CONSTRAINT insights_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY journal_entries
            ADD CONSTRAINT journal_entries_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY journal_entries
            ADD CONSTRAINT journal_entries_debt_id_fkey FOREIGN KEY (debt_id) REFERENCES debts(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY journal_entries
            ADD CONSTRAINT journal_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY journal_lines
            ADD CONSTRAINT journal_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY journal_lines
            ADD CONSTRAINT journal_lines_entry_id_fkey FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY notifications
            ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY recurring_items
            ADD CONSTRAINT recurring_items_account_id_fkey FOREIGN KEY (account_id) REFERENCES accounts(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY recurring_items
            ADD CONSTRAINT recurring_items_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY recurring_items
            ADD CONSTRAINT recurring_items_contra_account_id_fkey FOREIGN KEY (contra_account_id) REFERENCES accounts(id)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY recurring_items
            ADD CONSTRAINT recurring_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY report_insights
            ADD CONSTRAINT report_insights_report_id_fkey FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY report_insights
            ADD CONSTRAINT report_insights_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY reports
            ADD CONSTRAINT reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY unplanned_debts
            ADD CONSTRAINT unplanned_debts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY user_preferences
            ADD CONSTRAINT user_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        """
    )

    op.execute(
        """
        ALTER TABLE accounts ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE budget_limits ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE budget_periods ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE categories ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE debt_payments ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE debts ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE devices ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE insight_reviews ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE insights ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE notifications ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE recurring_items ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE report_insights ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE reports ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE POLICY rls_accounts ON accounts USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_budget_limits ON budget_limits USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_budget_periods ON budget_periods USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_categories ON categories USING (((user_id IS NULL) OR (user_id = (current_setting('app.current_user_id'::text, true))::uuid)))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_chat_messages ON chat_messages USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_debt_payments ON debt_payments USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_debts ON debts USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_devices ON devices USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_insight_reviews ON insight_reviews USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_insights ON insights USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_journal_entries ON journal_entries USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_journal_lines ON journal_lines USING ((EXISTS ( SELECT 1
           FROM journal_entries je
          WHERE ((je.id = journal_lines.entry_id) AND (je.user_id = (current_setting('app.current_user_id'::text, true))::uuid)))))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_notifications ON notifications USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_recurring_items ON recurring_items USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_report_insights ON report_insights USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_reports ON reports USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        CREATE POLICY rls_unplanned_debts ON unplanned_debts USING ((user_id = (current_setting('app.current_user_id'::text, true))::uuid))
        """
    )

    op.execute(
        """
        ALTER TABLE unplanned_debts ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        ALTER TABLE user_preferences FORCE ROW LEVEL SECURITY
        """
    )

    op.execute(
        """
        CREATE POLICY rls_user_preferences ON user_preferences
            USING (user_id = current_setting('app.current_user_id', true)::uuid)
        """
    )

    # -- category_hides: FKs diferidas hasta aca porque `users` se crea al
    # final del bloque de tablas (mismo patron que el resto del archivo).
    op.execute(
        """
        ALTER TABLE ONLY category_hides
            ADD CONSTRAINT category_hides_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES users(id) ON DELETE CASCADE
        """
    )
    op.execute(
        """
        ALTER TABLE ONLY category_hides
            ADD CONSTRAINT category_hides_category_id_fkey FOREIGN KEY (category_id)
                REFERENCES categories(id) ON DELETE CASCADE
        """
    )
    op.execute(
        """
        ALTER TABLE category_hides ENABLE ROW LEVEL SECURITY
        """
    )
    op.execute(
        """
        CREATE POLICY rls_category_hides ON category_hides
            USING (user_id = current_setting('app.current_user_id', true)::uuid)
        """
    )

    op.execute(
        """
        ALTER TABLE ONLY feedback
            ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id)
                REFERENCES users(id) ON DELETE CASCADE
        """
    )
    op.execute("ALTER TABLE feedback ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY rls_feedback ON feedback
            USING (
                user_id = current_setting('app.current_user_id', true)::uuid
                OR EXISTS (
                    SELECT 1 FROM users
                    WHERE users.id = current_setting('app.current_user_id', true)::uuid
                        AND users.role = 'admin'
                )
            )
        """
    )

    # Seed de categorias del sistema: solo de primer nivel (parent_id NULL),
    # a proposito -- no se siembran subcategorias por defecto. Cada usuario
    # arma su propio arbol de subcategorias debajo de estas (ver
    # ck_categories_subcategory_user_scoped mas arriba: una subcategoria
    # SIEMPRE requiere user_id, nunca puede ser una fila de sistema
    # compartida -- el constraint lo garantiza a nivel de base de datos, no
    # solo en category_service.create_category).
    op.execute(
        """
        INSERT INTO categories (user_id, name, type, icon, color, is_system, sort_order) VALUES
            (NULL, 'Comida y Bebidas',        'expense', 'utensils',         '#f5a623', TRUE, 10),
            (NULL, 'Transporte y Movilidad',  'expense', 'car',              '#e85d9c', TRUE, 20),
            (NULL, 'Vivienda y Hogar',        'expense', 'home',             '#4e8ef0', TRUE, 30),
            (NULL, 'Salud y Bienestar',       'expense', 'heart',            '#8b7cf6', TRUE, 40),
            (NULL, 'Ropa y Cuidado Personal', 'expense', 'shirt',            '#00c9a7', TRUE, 50),
            (NULL, 'Ocio y Entretenimiento',  'expense', 'gamepad-2',        '#f04e4e', TRUE, 60),
            (NULL, 'Educacion y Desarrollo',  'expense', 'graduation-cap',   '#f5a623', TRUE, 70),
            (NULL, 'Mascotas',                'expense', 'paw-print',        '#e85d9c', TRUE, 80),
            (NULL, 'Otro Gasto',              'expense', 'more-horizontal',  '#6f6f76', TRUE, 999),
            (NULL, 'Empleo principal',        'income',  'briefcase',        '#00c9a7', TRUE, 10),
            (NULL, 'Freelance',               'income',  'laptop',           '#4e8ef0', TRUE, 20),
            (NULL, 'Otro',                    'income',  'plus-circle',      '#6f6f76', TRUE, 999)
        """
    )

    # -- rol de reporting de Admin (ver README "Setup en una maquina nueva",
    # paso 3): CREATE ROLE es un paso manual con superuser porque
    # finanzas_user no tiene CREATEROLE a proposito. Si el rol todavia no
    # existe (deploy nuevo, o dev que no corrio ese paso), se omiten los
    # GRANTs sin fallar el deploy -- hay que crear el rol y volver a correr
    # `alembic upgrade head`.
    conn = op.get_bind()
    role_exists = conn.execute(
        sa.text("SELECT 1 FROM pg_roles WHERE rolname = :name"), {"name": ADMIN_ROLE_NAME}
    ).scalar()
    if not role_exists:
        print(
            f"[{revision}] el rol {ADMIN_ROLE_NAME} no existe todavia -- se omiten los "
            "GRANTs. Crearlo a mano con un superuser (ver README) y volver a correr "
            "`alembic upgrade head`."
        )
        return

    dbname = conn.execute(sa.text("SELECT current_database()")).scalar()
    op.execute(f'GRANT CONNECT ON DATABASE "{dbname}" TO {ADMIN_ROLE_NAME}')
    op.execute(f"GRANT USAGE ON SCHEMA public TO {ADMIN_ROLE_NAME}")
    op.execute(f"GRANT SELECT ON ALL TABLES IN SCHEMA public TO {ADMIN_ROLE_NAME}")
    op.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO {ADMIN_ROLE_NAME}"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS feedback CASCADE")
    op.execute("DROP TABLE IF EXISTS category_hides CASCADE")
    op.execute("DROP TABLE IF EXISTS journal_lines CASCADE")
    op.execute("DROP TABLE IF EXISTS journal_entries CASCADE")
    op.execute("DROP TABLE IF EXISTS budget_periods CASCADE")
    op.execute("DROP TABLE IF EXISTS budget_limits CASCADE")
    op.execute("DROP TABLE IF EXISTS recurring_items CASCADE")
    op.execute("DROP TABLE IF EXISTS report_insights CASCADE")
    op.execute("DROP TABLE IF EXISTS reports CASCADE")
    op.execute("DROP TABLE IF EXISTS insight_reviews CASCADE")
    op.execute("DROP TABLE IF EXISTS insights CASCADE")
    op.execute("DROP TABLE IF EXISTS notifications CASCADE")
    op.execute("DROP TABLE IF EXISTS chat_messages CASCADE")
    op.execute("DROP TABLE IF EXISTS debt_payments CASCADE")
    op.execute("DROP TABLE IF EXISTS debts CASCADE")
    op.execute("DROP TABLE IF EXISTS unplanned_debts CASCADE")
    op.execute("DROP TABLE IF EXISTS user_preferences CASCADE")
    op.execute("DROP TABLE IF EXISTS devices CASCADE")
    op.execute("DROP TABLE IF EXISTS categories CASCADE")
    op.execute("DROP TABLE IF EXISTS accounts CASCADE")
    op.execute("DROP TABLE IF EXISTS users CASCADE")
    op.execute("DROP FUNCTION IF EXISTS set_updated_at()")
