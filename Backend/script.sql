--
-- PostgreSQL database dump
--

\restrict Phax2YYqzrxxpJL7VpPr6gztuAGH2c4alJkkdrlaG3ZLzuonyNua4Ga6v1Tc2AJ

-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

-- Started on 2026-08-21 15:56:48

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 2 (class 3079 OID 16756)
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- TOC entry 5109 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- TOC entry 901 (class 1247 OID 16899)
-- Name: comment_visibility_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.comment_visibility_enum AS ENUM (
    'PUBLIC',
    'INTERNAL'
);


ALTER TYPE public.comment_visibility_enum OWNER TO postgres;

--
-- TOC entry 916 (class 1247 OID 16943)
-- Name: notification_type_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.notification_type_enum AS ENUM (
    'TICKET_CREATED',
    'TICKET_ASSIGNED',
    'TICKET_STATUS_CHANGED',
    'TICKET_COMMENTED',
    'TICKET_SLA_BREACHED'
);


ALTER TYPE public.notification_type_enum OWNER TO postgres;

--
-- TOC entry 895 (class 1247 OID 16866)
-- Name: ticket_priority_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.ticket_priority_enum AS ENUM (
    'LOW',
    'NORMAL',
    'HIGH',
    'CRITICAL'
);


ALTER TYPE public.ticket_priority_enum OWNER TO postgres;

--
-- TOC entry 892 (class 1247 OID 16852)
-- Name: ticket_status_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.ticket_status_enum AS ENUM (
    'OPEN',
    'ASSIGNED',
    'IN_PROGRESS',
    'RESOLVED',
    'CLOSED',
    'CANCELLED'
);


ALTER TYPE public.ticket_status_enum OWNER TO postgres;

--
-- TOC entry 883 (class 1247 OID 16811)
-- Name: user_role_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.user_role_enum AS ENUM (
    'ADMIN',
    'TECHNICIAN',
    'CLIENT'
);


ALTER TYPE public.user_role_enum OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 227 (class 1259 OID 16914)
-- Name: attachments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attachments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ticket_id uuid,
    comment_id uuid,
    uploaded_by_id uuid,
    bucket character varying(100) NOT NULL,
    storage_key character varying(500) NOT NULL,
    original_name character varying(255) NOT NULL,
    mime_type character varying(120) NOT NULL,
    size_bytes bigint NOT NULL,
    checksum character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT "CHK_attachments_ticket_or_comment" CHECK (((ticket_id IS NOT NULL) OR (comment_id IS NOT NULL)))
);


ALTER TABLE public.attachments OWNER TO postgres;

--
-- TOC entry 228 (class 1259 OID 16924)
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    actor_id uuid,
    action character varying(80) NOT NULL,
    entity_type character varying(60),
    entity_id uuid,
    ip_address inet,
    user_agent character varying(300),
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO postgres;

--
-- TOC entry 223 (class 1259 OID 16838)
-- Name: categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.categories (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(80) NOT NULL,
    description text,
    required_skill_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.categories OWNER TO postgres;

--
-- TOC entry 219 (class 1259 OID 16768)
-- Name: migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.migrations (
    id integer NOT NULL,
    "timestamp" bigint NOT NULL,
    name character varying NOT NULL
);


ALTER TABLE public.migrations OWNER TO postgres;

--
-- TOC entry 218 (class 1259 OID 16767)
-- Name: migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.migrations_id_seq OWNER TO postgres;

--
-- TOC entry 5110 (class 0 OID 0)
-- Dependencies: 218
-- Name: migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.migrations_id_seq OWNED BY public.migrations.id;


--
-- TOC entry 230 (class 1259 OID 16953)
-- Name: notifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    recipient_id uuid NOT NULL,
    type public.notification_type_enum NOT NULL,
    ticket_id uuid,
    title character varying(150) NOT NULL,
    body text NOT NULL,
    payload jsonb,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.notifications OWNER TO postgres;

--
-- TOC entry 229 (class 1259 OID 16935)
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.password_reset_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.password_reset_tokens OWNER TO postgres;

--
-- TOC entry 221 (class 1259 OID 16797)
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.refresh_tokens (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.refresh_tokens OWNER TO postgres;

--
-- TOC entry 222 (class 1259 OID 16826)
-- Name: skills; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.skills (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(80) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.skills OWNER TO postgres;

--
-- TOC entry 231 (class 1259 OID 16964)
-- Name: sla_policies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sla_policies (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    priority public.ticket_priority_enum NOT NULL,
    resolution_target_minutes integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.sla_policies OWNER TO postgres;

--
-- TOC entry 232 (class 1259 OID 16974)
-- Name: technician_profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.technician_profiles (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    max_concurrent_tickets integer DEFAULT 5 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.technician_profiles OWNER TO postgres;

--
-- TOC entry 233 (class 1259 OID 16986)
-- Name: technician_skills; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.technician_skills (
    technician_profile_id uuid NOT NULL,
    skill_id uuid NOT NULL,
    level smallint DEFAULT '3'::smallint NOT NULL
);


ALTER TABLE public.technician_skills OWNER TO postgres;

--
-- TOC entry 234 (class 1259 OID 16992)
-- Name: ticket_assignments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ticket_assignments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ticket_id uuid NOT NULL,
    technician_id uuid NOT NULL,
    assigned_by_id uuid,
    reason text,
    is_auto_suggested boolean DEFAULT false NOT NULL,
    assigned_at timestamp with time zone NOT NULL,
    unassigned_at timestamp with time zone
);


ALTER TABLE public.ticket_assignments OWNER TO postgres;

--
-- TOC entry 226 (class 1259 OID 16903)
-- Name: ticket_comments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ticket_comments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ticket_id uuid NOT NULL,
    author_id uuid,
    body text NOT NULL,
    visibility public.comment_visibility_enum DEFAULT 'PUBLIC'::public.comment_visibility_enum NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.ticket_comments OWNER TO postgres;

--
-- TOC entry 235 (class 1259 OID 17003)
-- Name: ticket_status_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ticket_status_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ticket_id uuid NOT NULL,
    from_status public.ticket_status_enum,
    to_status public.ticket_status_enum NOT NULL,
    changed_by_id uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.ticket_status_history OWNER TO postgres;

--
-- TOC entry 225 (class 1259 OID 16876)
-- Name: tickets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tickets (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    reference character varying(20) NOT NULL,
    title character varying(150) NOT NULL,
    description text NOT NULL,
    status public.ticket_status_enum DEFAULT 'OPEN'::public.ticket_status_enum NOT NULL,
    priority public.ticket_priority_enum DEFAULT 'NORMAL'::public.ticket_priority_enum NOT NULL,
    category_id uuid NOT NULL,
    created_by_id uuid NOT NULL,
    assignee_id uuid,
    site_label character varying(150),
    site_address text,
    sla_due_at timestamp with time zone,
    assigned_at timestamp with time zone,
    started_at timestamp with time zone,
    resolved_at timestamp with time zone,
    closed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE public.tickets OWNER TO postgres;

--
-- TOC entry 224 (class 1259 OID 16875)
-- Name: tickets_reference_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tickets_reference_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tickets_reference_seq OWNER TO postgres;

--
-- TOC entry 5111 (class 0 OID 0)
-- Dependencies: 224
-- Name: tickets_reference_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tickets_reference_seq OWNED BY public.tickets.reference;


--
-- TOC entry 220 (class 1259 OID 16781)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(255) NOT NULL,
    password character varying(255) NOT NULL,
    role public.user_role_enum DEFAULT 'CLIENT'::public.user_role_enum NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    first_name character varying(80),
    last_name character varying(80),
    phone character varying(30),
    deleted_at timestamp with time zone
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 4829 (class 2604 OID 16771)
-- Name: migrations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.migrations ALTER COLUMN id SET DEFAULT nextval('public.migrations_id_seq'::regclass);


--
-- TOC entry 4845 (class 2604 OID 16880)
-- Name: tickets reference; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tickets ALTER COLUMN reference SET DEFAULT ('TCK-'::text || lpad((nextval('public.tickets_reference_seq'::regclass))::text, 6, '0'::text));


--
-- TOC entry 4933 (class 2606 OID 17000)
-- Name: ticket_assignments PK_02235b218e5aa8feec218f459d2; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_assignments
    ADD CONSTRAINT "PK_02235b218e5aa8feec218f459d2" PRIMARY KEY (id);


--
-- TOC entry 4888 (class 2606 OID 16835)
-- Name: skills PK_0d3212120f4ecedf90864d7e298; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT "PK_0d3212120f4ecedf90864d7e298" PRIMARY KEY (id);


--
-- TOC entry 4913 (class 2606 OID 16932)
-- Name: audit_logs PK_1bb179d048bbc581caa3b013439; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY (id);


--
-- TOC entry 4892 (class 2606 OID 16848)
-- Name: categories PK_24dbc6126a28ff948da33e97d3b; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY (id);


--
-- TOC entry 4903 (class 2606 OID 16888)
-- Name: tickets PK_343bc942ae261cf7a1377f48fd0; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT "PK_343bc942ae261cf7a1377f48fd0" PRIMARY KEY (id);


--
-- TOC entry 4921 (class 2606 OID 16971)
-- Name: sla_policies PK_41b6803cef982534243a67b6302; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sla_policies
    ADD CONSTRAINT "PK_41b6803cef982534243a67b6302" PRIMARY KEY (id);


--
-- TOC entry 4909 (class 2606 OID 16923)
-- Name: attachments PK_5e1f050bcff31e3084a1d662412; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT "PK_5e1f050bcff31e3084a1d662412" PRIMARY KEY (id);


--
-- TOC entry 4919 (class 2606 OID 16961)
-- Name: notifications PK_6a72c3c0f683f6462415e653c3a; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY (id);


--
-- TOC entry 4886 (class 2606 OID 16803)
-- Name: refresh_tokens PK_7d8bee0204106019488c4c50ffa; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY (id);


--
-- TOC entry 4907 (class 2606 OID 16913)
-- Name: ticket_comments PK_811ed3b81dd8df6b9a92058d89c; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT "PK_811ed3b81dd8df6b9a92058d89c" PRIMARY KEY (id);


--
-- TOC entry 4877 (class 2606 OID 16775)
-- Name: migrations PK_8c82d7f526340ab734260ea46be; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.migrations
    ADD CONSTRAINT "PK_8c82d7f526340ab734260ea46be" PRIMARY KEY (id);


--
-- TOC entry 4879 (class 2606 OID 16792)
-- Name: users PK_a3ffb1c0c8416b9fc6f907b7433; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY (id);


--
-- TOC entry 4929 (class 2606 OID 16991)
-- Name: technician_skills PK_a86acf81247e97a4df8d0b7009d; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.technician_skills
    ADD CONSTRAINT "PK_a86acf81247e97a4df8d0b7009d" PRIMARY KEY (technician_profile_id, skill_id);


--
-- TOC entry 4925 (class 2606 OID 16983)
-- Name: technician_profiles PK_b8b333b43558d1423241cb4924e; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.technician_profiles
    ADD CONSTRAINT "PK_b8b333b43558d1423241cb4924e" PRIMARY KEY (id);


--
-- TOC entry 4915 (class 2606 OID 16941)
-- Name: password_reset_tokens PK_d16bebd73e844c48bca50ff8d3d; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT "PK_d16bebd73e844c48bca50ff8d3d" PRIMARY KEY (id);


--
-- TOC entry 4936 (class 2606 OID 17011)
-- Name: ticket_status_history PK_d989dae9e6078a6d4ce1aca63f7; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_status_history
    ADD CONSTRAINT "PK_d989dae9e6078a6d4ce1aca63f7" PRIMARY KEY (id);


--
-- TOC entry 4927 (class 2606 OID 16985)
-- Name: technician_profiles UQ_328f93227e883c577337c6a9551; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.technician_profiles
    ADD CONSTRAINT "UQ_328f93227e883c577337c6a9551" UNIQUE (user_id);


--
-- TOC entry 4905 (class 2606 OID 16890)
-- Name: tickets UQ_475c055bd3fc3ea3937e312ee2f; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT "UQ_475c055bd3fc3ea3937e312ee2f" UNIQUE (reference);


--
-- TOC entry 4890 (class 2606 OID 16837)
-- Name: skills UQ_81f05095507fd84aa2769b4a522; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT "UQ_81f05095507fd84aa2769b4a522" UNIQUE (name);


--
-- TOC entry 4923 (class 2606 OID 16973)
-- Name: sla_policies UQ_8287eac5c54cc675dc1ae300b9e; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sla_policies
    ADD CONSTRAINT "UQ_8287eac5c54cc675dc1ae300b9e" UNIQUE (priority);


--
-- TOC entry 4894 (class 2606 OID 16850)
-- Name: categories UQ_8b0be371d28245da6e4f4b61878; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT "UQ_8b0be371d28245da6e4f4b61878" UNIQUE (name);


--
-- TOC entry 4881 (class 2606 OID 16796)
-- Name: users UQ_97672ac88f789774dd47f7c8be3; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE (email);


--
-- TOC entry 4883 (class 2606 OID 16794)
-- Name: users UQ_fe0bb3f6520ee0469504521e710; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE (username);


--
-- TOC entry 4895 (class 1259 OID 16896)
-- Name: IDX_09a4d6db964c6b6ce11f8f1d92; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_09a4d6db964c6b6ce11f8f1d92" ON public.tickets USING btree (created_at);


--
-- TOC entry 4896 (class 1259 OID 16891)
-- Name: IDX_12b901b34113688b4786368510; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_12b901b34113688b4786368510" ON public.tickets USING btree (status);


--
-- TOC entry 4897 (class 1259 OID 16892)
-- Name: IDX_1cfb61a749963bfba02395e118; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_1cfb61a749963bfba02395e118" ON public.tickets USING btree (priority);


--
-- TOC entry 4884 (class 1259 OID 16804)
-- Name: IDX_3ddc983c5f7bcf132fd8732c3f; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_3ddc983c5f7bcf132fd8732c3f" ON public.refresh_tokens USING btree (user_id);


--
-- TOC entry 4898 (class 1259 OID 16895)
-- Name: IDX_5f2cc1c61d96a2ceabab5328be; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_5f2cc1c61d96a2ceabab5328be" ON public.tickets USING btree (sla_due_at);


--
-- TOC entry 4930 (class 1259 OID 17001)
-- Name: IDX_6e97efccac085b86674d84d069; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_6e97efccac085b86674d84d069" ON public.ticket_assignments USING btree (technician_id);


--
-- TOC entry 4910 (class 1259 OID 16933)
-- Name: IDX_audit_logs_action_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_audit_logs_action_created" ON public.audit_logs USING btree (action, created_at);


--
-- TOC entry 4911 (class 1259 OID 16934)
-- Name: IDX_audit_logs_actor_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_audit_logs_actor_created" ON public.audit_logs USING btree (actor_id, created_at);


--
-- TOC entry 4899 (class 1259 OID 16894)
-- Name: IDX_dff6e2b44c9b5e177114588772; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_dff6e2b44c9b5e177114588772" ON public.tickets USING btree (assignee_id);


--
-- TOC entry 4900 (class 1259 OID 16893)
-- Name: IDX_f131b2269095005a89841a11e4; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_f131b2269095005a89841a11e4" ON public.tickets USING btree (created_by_id);


--
-- TOC entry 4916 (class 1259 OID 16962)
-- Name: IDX_notifications_recipient_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_notifications_recipient_created" ON public.notifications USING btree (recipient_id, created_at);


--
-- TOC entry 4917 (class 1259 OID 16963)
-- Name: IDX_notifications_recipient_read; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_notifications_recipient_read" ON public.notifications USING btree (recipient_id, read_at);


--
-- TOC entry 4931 (class 1259 OID 17002)
-- Name: IDX_ticket_assignments_ticket_assigned; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_ticket_assignments_ticket_assigned" ON public.ticket_assignments USING btree (ticket_id, assigned_at);


--
-- TOC entry 4934 (class 1259 OID 17012)
-- Name: IDX_ticket_status_history_ticket_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_ticket_status_history_ticket_created" ON public.ticket_status_history USING btree (ticket_id, created_at);


--
-- TOC entry 4901 (class 1259 OID 16897)
-- Name: IDX_tickets_not_deleted; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IDX_tickets_not_deleted" ON public.tickets USING btree (id) WHERE (deleted_at IS NULL);


--
-- TOC entry 4938 (class 2606 OID 17013)
-- Name: categories FK_0e657dce84ece328162a2313ea0; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT "FK_0e657dce84ece328162a2313ea0" FOREIGN KEY (required_skill_id) REFERENCES public.skills(id) ON DELETE SET NULL;


--
-- TOC entry 4947 (class 2606 OID 17058)
-- Name: audit_logs FK_177183f29f438c488b5e8510cdb; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT "FK_177183f29f438c488b5e8510cdb" FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 4954 (class 2606 OID 17093)
-- Name: ticket_assignments FK_1f28749f7471a43f237d79eb7fd; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_assignments
    ADD CONSTRAINT "FK_1f28749f7471a43f237d79eb7fd" FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- TOC entry 4951 (class 2606 OID 17078)
-- Name: technician_profiles FK_328f93227e883c577337c6a9551; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.technician_profiles
    ADD CONSTRAINT "FK_328f93227e883c577337c6a9551" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4939 (class 2606 OID 17018)
-- Name: tickets FK_32a7f0e4e32a46a094b55f7c25c; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT "FK_32a7f0e4e32a46a094b55f7c25c" FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE RESTRICT;


--
-- TOC entry 4937 (class 2606 OID 16805)
-- Name: refresh_tokens FK_3ddc983c5f7bcf132fd8732c3f4; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT "FK_3ddc983c5f7bcf132fd8732c3f4" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4942 (class 2606 OID 17033)
-- Name: ticket_comments FK_4ee48e3e18e7c3ac35152a9fb7b; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT "FK_4ee48e3e18e7c3ac35152a9fb7b" FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- TOC entry 4948 (class 2606 OID 17063)
-- Name: password_reset_tokens FK_52ac39dd8a28730c63aeb428c9c; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT "FK_52ac39dd8a28730c63aeb428c9c" FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4957 (class 2606 OID 17108)
-- Name: ticket_status_history FK_52fa10cddeab4cf9d490c387a6c; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_status_history
    ADD CONSTRAINT "FK_52fa10cddeab4cf9d490c387a6c" FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- TOC entry 4949 (class 2606 OID 17068)
-- Name: notifications FK_5332a4daa46fd3f4e6625dd275d; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT "FK_5332a4daa46fd3f4e6625dd275d" FOREIGN KEY (recipient_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- TOC entry 4943 (class 2606 OID 17038)
-- Name: ticket_comments FK_580b2a4f5b78b556eb684f96dbe; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_comments
    ADD CONSTRAINT "FK_580b2a4f5b78b556eb684f96dbe" FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 4955 (class 2606 OID 17098)
-- Name: ticket_assignments FK_6e97efccac085b86674d84d0690; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_assignments
    ADD CONSTRAINT "FK_6e97efccac085b86674d84d0690" FOREIGN KEY (technician_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- TOC entry 4944 (class 2606 OID 17053)
-- Name: attachments FK_70a38fc450d3b433c86b67e69d6; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT "FK_70a38fc450d3b433c86b67e69d6" FOREIGN KEY (uploaded_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 4945 (class 2606 OID 17043)
-- Name: attachments FK_73d871f247ffebda5dc3f0df8a4; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT "FK_73d871f247ffebda5dc3f0df8a4" FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- TOC entry 4956 (class 2606 OID 17103)
-- Name: ticket_assignments FK_8cbb7a584b222d43179be81108b; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_assignments
    ADD CONSTRAINT "FK_8cbb7a584b222d43179be81108b" FOREIGN KEY (assigned_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 4952 (class 2606 OID 17083)
-- Name: technician_skills FK_8f5e1115763dc722111b7c7c0c2; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.technician_skills
    ADD CONSTRAINT "FK_8f5e1115763dc722111b7c7c0c2" FOREIGN KEY (technician_profile_id) REFERENCES public.technician_profiles(id) ON DELETE CASCADE;


--
-- TOC entry 4953 (class 2606 OID 17088)
-- Name: technician_skills FK_a38d90b87cbce1636ba44437bf2; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.technician_skills
    ADD CONSTRAINT "FK_a38d90b87cbce1636ba44437bf2" FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;


--
-- TOC entry 4958 (class 2606 OID 17113)
-- Name: ticket_status_history FK_b30e46a9e8ef7c01564465a30a3; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ticket_status_history
    ADD CONSTRAINT "FK_b30e46a9e8ef7c01564465a30a3" FOREIGN KEY (changed_by_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 4946 (class 2606 OID 17048)
-- Name: attachments FK_b4b436948b623e8e765bd1c0977; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT "FK_b4b436948b623e8e765bd1c0977" FOREIGN KEY (comment_id) REFERENCES public.ticket_comments(id) ON DELETE CASCADE;


--
-- TOC entry 4950 (class 2606 OID 17073)
-- Name: notifications FK_d506dd64e3806b61e88a26714e3; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT "FK_d506dd64e3806b61e88a26714e3" FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- TOC entry 4940 (class 2606 OID 17028)
-- Name: tickets FK_dff6e2b44c9b5e177114588772f; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT "FK_dff6e2b44c9b5e177114588772f" FOREIGN KEY (assignee_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- TOC entry 4941 (class 2606 OID 17023)
-- Name: tickets FK_f131b2269095005a89841a11e4a; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT "FK_f131b2269095005a89841a11e4a" FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE RESTRICT;


-- Completed on 2026-08-21 15:56:49

--
-- PostgreSQL database dump complete
--

\unrestrict Phax2YYqzrxxpJL7VpPr6gztuAGH2c4alJkkdrlaG3ZLzuonyNua4Ga6v1Tc2AJ

