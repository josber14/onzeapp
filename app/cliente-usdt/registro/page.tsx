"use client";

import { useState } from "react";
import Link from "next/link";
import PasswordInput from "@/components/password-input";

// tenantId fijo por ahora — este producto es para UN solo negocio (el
// tenant del usuario). Si en el futuro se vende a más negocios, esto pasa
// a resolverse por subdominio o código de invitación.
const TENANT_ID = 1;

const MONTO_MENSUAL_OPTIONS = [
  "0 a $700.000",
  "$700.000 a $1.500.000",
  "$1.500.000 a $3.000.000",
  "$3.000.000 a $6.000.000",
  "Mas de $6.000.000",
];

const ORIGEN_FONDOS_OPTIONS = ["Herencia", "Inversiones", "Honorarios/Sueldos", "Propiedades", "Otros (Especificar)"];

const US_PERSON_OPTIONS = [
  { value: "no_1", label: "Declaro que no soy una \"US Person\"" },
  { value: "no_2", label: "Declaro NO ser \"US Person\"" },
  { value: "si", label: "Declaro SI ser \"US Person\"" },
];

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-emerald-400";
const labelClass = "mb-3 block text-sm text-slate-200";
const sectionTitleClass = "mb-4 mt-8 text-base font-bold text-emerald-400";

function Label({ children }: { children: React.ReactNode }) {
  return <label className={labelClass}>{children}</label>;
}

export default function ClienteUsdtRegistroPage() {
  // Cuenta
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Sección 1 — Conocimiento del cliente
  const [rut, setRut] = useState("");
  const [nacionalidad, setNacionalidad] = useState("");
  const [profesion, setProfesion] = useState("");
  const [actividadGiro, setActividadGiro] = useState("");
  const [domicilio, setDomicilio] = useState("");
  const [telefono, setTelefono] = useState("");
  const [nombreBanco, setNombreBanco] = useState("");
  const [tipoCuenta, setTipoCuenta] = useState("");
  const [numeroCuenta, setNumeroCuenta] = useState("");
  const [montoMensualEsperado, setMontoMensualEsperado] = useState("");
  const [productosOperar, setProductosOperar] = useState<string[]>([]);
  const [productosOtroEspecificar, setProductosOtroEspecificar] = useState("");

  // Sección 2 — Origen de fondos
  const [dineroEsPropio, setDineroEsPropio] = useState<"si" | "no" | "">("");
  const [duenoNombre, setDuenoNombre] = useState("");
  const [duenoRut, setDuenoRut] = useState("");
  const [duenoNacionalidad, setDuenoNacionalidad] = useState("");
  const [duenoActividad, setDuenoActividad] = useState("");
  const [duenoDomicilio, setDuenoDomicilio] = useState("");
  const [duenoTelefono, setDuenoTelefono] = useState("");
  const [origenFondos, setOrigenFondos] = useState("");
  const [origenFondosOtroEspecificar, setOrigenFondosOtroEspecificar] = useState("");
  const [declaracionPep, setDeclaracionPep] = useState<"si" | "no" | "">("");
  const [declaracionUsPerson, setDeclaracionUsPerson] = useState("");

  // Sección 3 — Términos
  const [aceptaTerminos, setAceptaTerminos] = useState<"si" | "no" | "">("");
  const [selfie, setSelfie] = useState<File | null>(null);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  function toggleProducto(value: string) {
    setProductosOperar((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage("");

    if (aceptaTerminos !== "si") {
      setMessage("Debes aceptar los términos y condiciones para continuar.");
      return;
    }
    if (!selfie) {
      setMessage("Sube la selfie sosteniendo tu documento de identidad.");
      return;
    }

    const kycData: Record<string, any> = {
      rut, nacionalidad, profesion, actividadGiro, domicilio, telefono,
      nombreBanco, tipoCuenta, numeroCuenta, montoMensualEsperado,
      productosOperar, productosOperarOtroEspecificar: productosOtroEspecificar,
      dineroEsPropio: dineroEsPropio === "si",
      origenFondos, origenFondosOtroEspecificar,
      declaracionPep, declaracionUsPerson,
      aceptaTerminos: aceptaTerminos === "si",
    };
    if (dineroEsPropio === "no") {
      kycData.duenoReal = {
        nombre: duenoNombre, rut: duenoRut, nacionalidad: duenoNacionalidad,
        actividad: duenoActividad, domicilio: duenoDomicilio, telefono: duenoTelefono,
      };
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("tenantId", String(TENANT_ID));
      formData.append("fullName", fullName);
      formData.append("email", email);
      formData.append("password", password);
      formData.append("kycData", JSON.stringify(kycData));
      formData.append("selfie", selfie);

      const res = await fetch("/api/usdt-client/register", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMessage(data.error || "No se pudo registrar.");
        return;
      }
      setDone(true);
    } catch {
      setMessage("Ocurrió un error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#041126] px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-slate-100">
          <h1 className="mb-3 text-xl font-bold">Registro recibido</h1>
          <p className="text-sm text-slate-300">
            Tu cuenta quedó en revisión. Te avisaremos apenas esté aprobada para que puedas comprar.
          </p>
          <Link href="/" className="mt-4 inline-block text-sm text-emerald-400 hover:underline">
            ← Volver al inicio
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen justify-center bg-[#041126] px-4 py-10">
      <form onSubmit={handleSubmit} className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/5 p-8 text-slate-100">
        <Link href="/" className="mb-4 inline-block text-sm text-slate-400 hover:text-slate-200">
          ← Volver al inicio
        </Link>
        <h1 className="mb-1 text-xl font-bold">Crear cuenta</h1>
        <p className="mb-2 text-sm text-slate-400">Compra USDT directo, con precio en vivo.</p>
        <p className="mb-6 text-xs text-slate-500">
          En cumplimiento a la ley 19.913, todos los clientes deben completar el siguiente formulario de conocimiento del cliente (KYC).
        </p>

        <Label>Nombre completo (persona natural: nombre y apellido / empresa: razón social)
          <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Label>
        <Label>Correo electrónico
          <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Label>
        <Label>Contraseña
          <PasswordInput
            className={`${inputClass} pr-11`}
            iconClassName="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 transition hover:text-slate-300"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </Label>

        <h2 className={sectionTitleClass}>Sección 1 — Conocimiento del cliente</h2>

        <Label>RUT
          <input className={inputClass} value={rut} onChange={(e) => setRut(e.target.value)} required />
        </Label>
        <Label>Nacionalidad
          <input className={inputClass} value={nacionalidad} onChange={(e) => setNacionalidad(e.target.value)} required />
        </Label>
        <Label>Profesión
          <input className={inputClass} value={profesion} onChange={(e) => setProfesion(e.target.value)} required />
        </Label>
        <Label>Actividad que realiza / giro de la empresa
          <input className={inputClass} value={actividadGiro} onChange={(e) => setActividadGiro(e.target.value)} required />
        </Label>
        <Label>Domicilio completo
          <input className={inputClass} value={domicilio} onChange={(e) => setDomicilio(e.target.value)} required />
        </Label>
        <Label>Teléfono
          <input className={inputClass} value={telefono} onChange={(e) => setTelefono(e.target.value)} required />
        </Label>

        <p className="mb-2 mt-4 text-sm font-semibold text-slate-300">Antecedentes bancarios</p>
        <Label>Nombre del banco
          <input className={inputClass} value={nombreBanco} onChange={(e) => setNombreBanco(e.target.value)} />
        </Label>
        <Label>Tipo de cuenta
          <select className={inputClass} value={tipoCuenta} onChange={(e) => setTipoCuenta(e.target.value)} required>
            <option value="">Selecciona...</option>
            <option value="Vista">Vista</option>
            <option value="Cuenta Corriente">Cuenta Corriente</option>
            <option value="Ahorro">Ahorro</option>
          </select>
        </Label>
        <Label>Número de cuenta
          <input className={inputClass} value={numeroCuenta} onChange={(e) => setNumeroCuenta(e.target.value)} required />
        </Label>

        <Label>Monto esperado de transacciones mensuales
          <select className={inputClass} value={montoMensualEsperado} onChange={(e) => setMontoMensualEsperado(e.target.value)} required>
            <option value="">Selecciona...</option>
            {MONTO_MENSUAL_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Label>

        <p className="mb-2 mt-4 text-sm font-semibold text-slate-300">Productos a operar</p>
        <label className="mb-2 flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={productosOperar.includes("Compra y venta de activos digitales")}
            onChange={() => toggleProducto("Compra y venta de activos digitales")} />
          Compra y venta de activos digitales (Bitcoins, USDT u otros)
        </label>
        <label className="mb-2 flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={productosOperar.includes("Otros")} onChange={() => toggleProducto("Otros")} />
          Otros (especificar)
        </label>
        {productosOperar.includes("Otros") && (
          <input className={inputClass + " mb-3"} placeholder="Especificar" value={productosOtroEspecificar}
            onChange={(e) => setProductosOtroEspecificar(e.target.value)} />
        )}

        <h2 className={sectionTitleClass}>Sección 2 — Declaración origen de fondos</h2>
        <div className="mb-4 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-slate-400">
          Como cliente de Zinple SpA, certifico y declaro que los activos, valores o instrumentos financieros o no
          financieros que han sido o serán abonados o depositados no provienen, directa o indirectamente, de
          actividades ilícitas contempladas en la Ley Nº 19.913 ni en la Ley Nº 20.393; que no provienen de un
          Shell Bank, terroristas u organizaciones restringidas por listas internacionales (OFAC, ONU, etc.); y que
          no provienen de una Persona Expuesta Políticamente (PEP) sin la debida diligencia correspondiente. Certifico
          haber leído y comprendido esta declaración.
        </div>

        <Label>¿El dinero con que realizará la operación es de su propiedad?
          <select className={inputClass} value={dineroEsPropio} onChange={(e) => setDineroEsPropio(e.target.value as "si" | "no")} required>
            <option value="">Selecciona...</option>
            <option value="si">Sí</option>
            <option value="no">No</option>
          </select>
        </Label>

        {dineroEsPropio === "no" && (
          <div className="mb-3 rounded-lg border border-white/10 p-3">
            <p className="mb-2 text-sm text-slate-300">Datos del dueño real del dinero</p>
            <input className={inputClass + " mb-2"} placeholder="Nombre / Razón social" value={duenoNombre} onChange={(e) => setDuenoNombre(e.target.value)} required />
            <input className={inputClass + " mb-2"} placeholder="RUT" value={duenoRut} onChange={(e) => setDuenoRut(e.target.value)} required />
            <input className={inputClass + " mb-2"} placeholder="Nacionalidad" value={duenoNacionalidad} onChange={(e) => setDuenoNacionalidad(e.target.value)} required />
            <input className={inputClass + " mb-2"} placeholder="Actividad / Giro" value={duenoActividad} onChange={(e) => setDuenoActividad(e.target.value)} required />
            <input className={inputClass + " mb-2"} placeholder="Domicilio" value={duenoDomicilio} onChange={(e) => setDuenoDomicilio(e.target.value)} required />
            <input className={inputClass} placeholder="Teléfono" value={duenoTelefono} onChange={(e) => setDuenoTelefono(e.target.value)} required />
          </div>
        )}

        <Label>Origen de los fondos
          <select className={inputClass} value={origenFondos} onChange={(e) => setOrigenFondos(e.target.value)} required>
            <option value="">Selecciona...</option>
            {ORIGEN_FONDOS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Label>
        {origenFondos === "Otros (Especificar)" && (
          <input className={inputClass + " mb-3"} placeholder="Especificar" value={origenFondosOtroEspecificar}
            onChange={(e) => setOrigenFondosOtroEspecificar(e.target.value)} />
        )}

        <Label>Declaración de vínculo con Personas Expuestas Políticamente (PEP)
          <select className={inputClass} value={declaracionPep} onChange={(e) => setDeclaracionPep(e.target.value as "si" | "no")} required>
            <option value="">Selecciona...</option>
            <option value="si">Declaro Sí ser PEP</option>
            <option value="no">Declaro no ser PEP</option>
          </select>
        </Label>

        <Label>Declaración US Person
          <select className={inputClass} value={declaracionUsPerson} onChange={(e) => setDeclaracionUsPerson(e.target.value)} required>
            <option value="">Selecciona...</option>
            {US_PERSON_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Label>

        <h2 className={sectionTitleClass}>Sección 3 — Términos y condiciones</h2>
        <div className="mb-4 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-slate-400">
          Zinple SpA es una entidad supervisada por la Unidad de Análisis Financiero chilena (UAF). Al registrarte
          aceptas los Términos y Condiciones completos regulados por las leyes Nº 21.121, Nº 20.393, Nº 19.913,
          Nº 21.132 y las circulares de la UAF, incluyendo el tratamiento de tus datos personales, la naturaleza
          intransferible de tu cuenta, y las limitaciones de responsabilidad de Zinple SpA respecto al origen de los
          activos digitales transados. El documento completo está disponible bajo solicitud.
        </div>

        <Label>He leído y acepto los términos y condiciones
          <select className={inputClass} value={aceptaTerminos} onChange={(e) => setAceptaTerminos(e.target.value as "si" | "no")} required>
            <option value="">Selecciona...</option>
            <option value="si">SI</option>
            <option value="no">NO</option>
          </select>
        </Label>

        <Label>Subir selfie sosteniendo documento de identidad
          <input type="file" accept="image/*" className={inputClass + " file:mr-3 file:rounded file:border-0 file:bg-emerald-500 file:px-3 file:py-1 file:text-black"}
            onChange={(e) => setSelfie(e.target.files?.[0] || null)} required />
        </Label>

        {message && <p className="mb-4 mt-2 text-sm text-rose-400">{message}</p>}

        <button type="submit" disabled={loading}
          className="mt-4 w-full rounded-lg bg-emerald-500 py-2 font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50">
          {loading ? "Enviando..." : "Registrarme"}
        </button>

        <p className="mt-4 text-center text-sm text-slate-400">
          ¿Ya tienes cuenta?{" "}
          <a href="/cliente-usdt/login" className="text-emerald-400 hover:underline">Inicia sesión</a>
        </p>
      </form>
    </main>
  );
}
