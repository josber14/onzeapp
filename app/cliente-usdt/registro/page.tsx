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

const ORIGEN_FONDOS_OPTIONS = ["Herencia", "Inversiones", "Ahorros", "Honorarios/Sueldos", "Propiedades", "Otros (Especificar)"];

const US_PERSON_OPTIONS = [
  { value: "no_1", label: "Declaro que no soy una \"US Person\"" },
  { value: "no_2", label: "Declaro NO ser \"US Person\"" },
  { value: "si", label: "Declaro SI ser \"US Person\"" },
];

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-emerald-400";
const labelClass = "mb-3 block text-sm text-slate-200";
const sectionTitleClass = "mb-4 mt-8 text-base font-bold text-emerald-400";

// Registro por pasos -- pedido explícito del usuario (ago 2026): el registro
// debe ir "por sesión" (un paso a la vez), no todo junto en una sola
// pantalla larga. Personal y Empresa piden datos distintos en el paso 2 y en
// el cierre del paso 4 (selfie vs ERUT), pero comparten la misma mecánica de
// pasos/validación/navegación.
const PERSONAL_STEPS = [
  { n: 1, label: "Cuenta" },
  { n: 2, label: "Conocimiento del cliente" },
  { n: 3, label: "Antecedentes bancarios" },
  { n: 4, label: "Origen de fondos" },
] as const;

const EMPRESA_STEPS = [
  { n: 1, label: "Cuenta" },
  { n: 2, label: "Representante legal" },
  { n: 3, label: "Antecedentes bancarios" },
  { n: 4, label: "Origen de fondos" },
] as const;

function Label({ children }: { children: React.ReactNode }) {
  return <label className={labelClass}>{children}</label>;
}

export default function ClienteUsdtRegistroPage() {
  // Tipo de cliente -- determina qué se le va a pedir en el formulario.
  const [tipoCliente, setTipoCliente] = useState<"personal" | "empresa">("personal");

  // Paso actual del registro (1 a 4).
  const [step, setStep] = useState(1);

  function switchTipoCliente(next: "personal" | "empresa") {
    setTipoCliente(next);
    setStep(1);
    setMessage("");
  }

  // Cuenta -- Personal: nombre propio. Empresa: razón social.
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Conocimiento del cliente / Representante legal (Empresa)
  const [representanteNombre, setRepresentanteNombre] = useState("");
  const [rut, setRut] = useState("");
  const [nacionalidad, setNacionalidad] = useState("");
  const [profesion, setProfesion] = useState("");
  const [actividadGiro, setActividadGiro] = useState("");
  const [domicilio, setDomicilio] = useState("");
  const [telefono, setTelefono] = useState("");

  // Antecedentes bancarios (igual para Personal y Empresa)
  const [nombreBanco, setNombreBanco] = useState("");
  const [tipoCuenta, setTipoCuenta] = useState("");
  const [numeroCuenta, setNumeroCuenta] = useState("");
  const [montoMensualEsperado, setMontoMensualEsperado] = useState("");
  const [productosOperar, setProductosOperar] = useState<string[]>([]);
  const [productosOtroEspecificar, setProductosOtroEspecificar] = useState("");

  // Origen de fondos
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

  // Términos + documento -- se piden al final del paso de origen de fondos.
  // Personal sube selfie con su documento; Empresa sube el ERUT.
  const [aceptaTerminos, setAceptaTerminos] = useState<"si" | "no" | "">("");
  const [selfie, setSelfie] = useState<File | null>(null);

  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  function toggleProducto(value: string) {
    setProductosOperar((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]));
  }

  function buildKycData(): Record<string, any> {
    const kycData: Record<string, any> = {
      tipoCliente,
      representanteNombre,
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
    return kycData;
  }

  async function submitRegistration() {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("tenantId", String(TENANT_ID));
      formData.append("fullName", fullName);
      formData.append("email", email);
      formData.append("password", password);
      formData.append("kycData", JSON.stringify(buildKycData()));
      // El campo se sigue llamando "selfie" internamente (mismo endpoint,
      // mismo storage) aunque para Empresa lo que se sube es el ERUT -- ver
      // validateEmpresaStep, que ya pide el archivo con el mensaje correcto.
      formData.append("selfie", selfie as File);

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

  // Validación por paso -- antes de avanzar, revisa que lo obligatorio de
  // ESE paso esté completo (no se usa validación HTML nativa porque los
  // pasos siguientes ni siquiera están montados en el DOM).
  function validatePersonalStep(n: number): string | null {
    if (n === 1) {
      if (!fullName.trim()) return "Ingresa tu nombre completo.";
      if (!email.trim()) return "Ingresa tu correo electrónico.";
      if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
    }
    if (n === 2) {
      if (!rut.trim()) return "Ingresa tu RUT.";
      if (!nacionalidad.trim()) return "Ingresa tu nacionalidad.";
      if (!profesion.trim()) return "Ingresa tu profesión.";
      if (!telefono.trim()) return "Ingresa tu teléfono.";
      if (!domicilio.trim()) return "Ingresa tu domicilio.";
    }
    if (n === 3) {
      if (!tipoCuenta) return "Selecciona el tipo de cuenta.";
      if (!numeroCuenta.trim()) return "Ingresa el número de cuenta.";
      if (!montoMensualEsperado) return "Selecciona el monto esperado de transacciones mensuales.";
    }
    if (n === 4) {
      if (!dineroEsPropio) return "Indica si el dinero es de tu propiedad.";
      if (dineroEsPropio === "no" && (!duenoNombre.trim() || !duenoRut.trim() || !duenoNacionalidad.trim() || !duenoActividad.trim() || !duenoDomicilio.trim() || !duenoTelefono.trim())) {
        return "Completa los datos del dueño real del dinero.";
      }
      if (!origenFondos) return "Selecciona el origen de los fondos.";
      if (!declaracionPep) return "Completa la declaración de vínculo con PEP.";
      if (!declaracionUsPerson) return "Completa la declaración US Person.";
      if (aceptaTerminos !== "si") return "Debes aceptar los términos y condiciones para continuar.";
      if (!selfie) return "Sube la selfie sosteniendo tu documento de identidad.";
    }
    return null;
  }

  function validateEmpresaStep(n: number): string | null {
    if (n === 1) {
      if (!fullName.trim()) return "Ingresa la razón social.";
      if (!email.trim()) return "Ingresa el correo electrónico.";
      if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
    }
    if (n === 2) {
      if (!representanteNombre.trim()) return "Ingresa el nombre del representante legal.";
      if (!rut.trim()) return "Ingresa el RUT del representante legal.";
      if (!nacionalidad.trim()) return "Ingresa la nacionalidad del representante legal.";
      if (!profesion.trim()) return "Ingresa la profesión del representante legal.";
      if (!telefono.trim()) return "Ingresa el teléfono.";
      if (!domicilio.trim()) return "Ingresa el domicilio de la empresa.";
    }
    if (n === 3) {
      if (!tipoCuenta) return "Selecciona el tipo de cuenta.";
      if (!numeroCuenta.trim()) return "Ingresa el número de cuenta.";
      if (!montoMensualEsperado) return "Selecciona el monto esperado de transacciones mensuales.";
    }
    if (n === 4) {
      if (!actividadGiro.trim()) return "Ingresa la actividad que realiza la empresa.";
      if (!dineroEsPropio) return "Indica si el dinero es de propiedad de la empresa.";
      if (dineroEsPropio === "no" && (!duenoNombre.trim() || !duenoRut.trim() || !duenoNacionalidad.trim() || !duenoActividad.trim() || !duenoDomicilio.trim() || !duenoTelefono.trim())) {
        return "Completa los datos del dueño real del dinero.";
      }
      if (!origenFondos) return "Selecciona el origen de los fondos.";
      if (!declaracionPep) return "Completa la declaración de vínculo con PEP.";
      if (!declaracionUsPerson) return "Completa la declaración US Person.";
      if (aceptaTerminos !== "si") return "Debes aceptar los términos y condiciones para continuar.";
      if (!selfie) return "Sube el ERUT de la empresa.";
    }
    return null;
  }

  function goNext() {
    const error = tipoCliente === "personal" ? validatePersonalStep(step) : validateEmpresaStep(step);
    if (error) {
      setMessage(error);
      return;
    }
    setMessage("");
    if (step === 4) {
      submitRegistration();
      return;
    }
    setStep((s) => s + 1);
  }

  function goBack() {
    setMessage("");
    setStep((s) => Math.max(1, s - 1));
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

  const steps = tipoCliente === "personal" ? PERSONAL_STEPS : EMPRESA_STEPS;

  return (
    <main className="flex min-h-screen justify-center bg-[#041126] px-4 py-10">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-white/5 p-8 text-slate-100">
        <Link href="/" className="mb-4 inline-block text-sm text-slate-400 hover:text-slate-200">
          ← Volver al inicio
        </Link>
        <h1 className="mb-1 text-xl font-bold">Crear cuenta</h1>
        <p className="mb-2 text-sm text-slate-400">Compra USDT directo, con precio en vivo.</p>
        <p className="mb-6 text-xs text-slate-500">
          En cumplimiento a la ley 19.913, todos los clientes deben completar el siguiente formulario de conocimiento del cliente (KYC).
        </p>

        <div className="mb-6 flex gap-1 rounded-lg border border-white/10 bg-black/20 p-1" role="tablist" aria-label="Tipo de cliente">
          <button
            type="button"
            role="tab"
            aria-selected={tipoCliente === "personal"}
            onClick={() => switchTipoCliente("personal")}
            className={`flex-1 rounded-md py-2 text-sm font-semibold transition ${
              tipoCliente === "personal" ? "bg-emerald-500 text-black" : "text-slate-300 hover:text-white"
            }`}
          >
            Personal
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tipoCliente === "empresa"}
            onClick={() => switchTipoCliente("empresa")}
            className={`flex-1 rounded-md py-2 text-sm font-semibold transition ${
              tipoCliente === "empresa" ? "bg-emerald-500 text-black" : "text-slate-300 hover:text-white"
            }`}
          >
            Empresa
          </button>
        </div>

        <div className="mb-6 flex items-center justify-between">
          {steps.map((s) => (
            <div key={s.n} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  s.n === step ? "bg-emerald-500 text-black" : s.n < step ? "bg-emerald-500/30 text-emerald-300" : "bg-white/10 text-slate-400"
                }`}
              >
                {s.n < step ? "✓" : s.n}
              </div>
              <span className={`text-center text-[10px] leading-tight ${s.n === step ? "text-slate-200" : "text-slate-500"}`}>{s.label}</span>
            </div>
          ))}
        </div>

        {step === 1 && (
          <>
            <Label>{tipoCliente === "personal" ? "Nombre completo" : "Razón social"}
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
          </>
        )}

        {step === 2 && tipoCliente === "personal" && (
          <>
            <h2 className={sectionTitleClass + " mt-0"}>Conocimiento del cliente</h2>
            <Label>RUT
              <input className={inputClass} value={rut} onChange={(e) => setRut(e.target.value)} required />
            </Label>
            <Label>Nacionalidad
              <input className={inputClass} value={nacionalidad} onChange={(e) => setNacionalidad(e.target.value)} required />
            </Label>
            <Label>Profesión
              <input className={inputClass} value={profesion} onChange={(e) => setProfesion(e.target.value)} required />
            </Label>
            <Label>Teléfono
              <input className={inputClass} value={telefono} onChange={(e) => setTelefono(e.target.value)} required />
            </Label>
            <Label>Domicilio
              <input className={inputClass} value={domicilio} onChange={(e) => setDomicilio(e.target.value)} required />
            </Label>
          </>
        )}

        {step === 2 && tipoCliente === "empresa" && (
          <>
            <h2 className={sectionTitleClass + " mt-0"}>Conocimiento del cliente / Representante legal de la empresa</h2>
            <Label>Nombre del representante legal
              <input className={inputClass} value={representanteNombre} onChange={(e) => setRepresentanteNombre(e.target.value)} required />
            </Label>
            <Label>RUT
              <input className={inputClass} value={rut} onChange={(e) => setRut(e.target.value)} required />
            </Label>
            <Label>Nacionalidad
              <input className={inputClass} value={nacionalidad} onChange={(e) => setNacionalidad(e.target.value)} required />
            </Label>
            <Label>Profesión
              <input className={inputClass} value={profesion} onChange={(e) => setProfesion(e.target.value)} required />
            </Label>
            <Label>Teléfono
              <input className={inputClass} value={telefono} onChange={(e) => setTelefono(e.target.value)} required />
            </Label>
            <Label>Domicilio de la empresa
              <input className={inputClass} value={domicilio} onChange={(e) => setDomicilio(e.target.value)} required />
            </Label>
          </>
        )}

        {step === 3 && (
          <>
            <h2 className={sectionTitleClass + " mt-0"}>Antecedentes bancarios</h2>
            <p className="mb-4 text-xs text-slate-500">Datos del banco desde donde vas a realizar las transferencias.</p>
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
          </>
        )}

        {step === 4 && (
          <>
            <h2 className={sectionTitleClass + " mt-0"}>Declaración origen de fondos</h2>
            <div className="mb-4 max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-relaxed text-slate-400">
              Como cliente de Zinple SpA, certifico y declaro que los activos, valores o instrumentos financieros o no
              financieros que han sido o serán abonados o depositados no provienen, directa o indirectamente, de
              actividades ilícitas contempladas en la Ley Nº 19.913 ni en la Ley Nº 20.393; que no provienen de un
              Shell Bank, terroristas u organizaciones restringidas por listas internacionales (OFAC, ONU, etc.); y que
              no provienen de una Persona Expuesta Políticamente (PEP) sin la debida diligencia correspondiente. Certifico
              haber leído y comprendido esta declaración.
            </div>

            {tipoCliente === "empresa" && (
              <Label>Actividad que realiza la empresa
                <input className={inputClass} value={actividadGiro} onChange={(e) => setActividadGiro(e.target.value)} required />
              </Label>
            )}

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

            <Label>He leído y acepto los términos y condiciones
              <select className={inputClass} value={aceptaTerminos} onChange={(e) => setAceptaTerminos(e.target.value as "si" | "no")} required>
                <option value="">Selecciona...</option>
                <option value="si">SI</option>
                <option value="no">NO</option>
              </select>
            </Label>

            {tipoCliente === "personal" ? (
              <Label>Subir selfie sosteniendo documento de identidad
                <input type="file" accept="image/*" className={inputClass + " file:mr-3 file:rounded file:border-0 file:bg-emerald-500 file:px-3 file:py-1 file:text-black"}
                  onChange={(e) => setSelfie(e.target.files?.[0] || null)} required />
              </Label>
            ) : (
              <Label>Subir ERUT de la empresa
                <input type="file" accept="image/*,.pdf" className={inputClass + " file:mr-3 file:rounded file:border-0 file:bg-emerald-500 file:px-3 file:py-1 file:text-black"}
                  onChange={(e) => setSelfie(e.target.files?.[0] || null)} required />
              </Label>
            )}
          </>
        )}

        {message && <p className="mb-4 mt-2 text-sm text-rose-400">{message}</p>}

        <div className="mt-4 flex gap-3">
          {step > 1 && (
            <button type="button" onClick={goBack}
              className="flex-1 rounded-lg border border-white/10 bg-black/20 py-2 font-semibold text-slate-200 transition hover:bg-black/40">
              ← Atrás
            </button>
          )}
          <button type="button" onClick={goNext} disabled={loading}
            className="flex-1 rounded-lg bg-emerald-500 py-2 font-semibold text-black transition hover:bg-emerald-400 disabled:opacity-50">
            {step < 4 ? "Continuar" : loading ? "Enviando..." : "Registrarme"}
          </button>
        </div>

        <p className="mt-4 text-center text-sm text-slate-400">
          ¿Ya tienes cuenta?{" "}
          <a href="/cliente-usdt/login" className="text-emerald-400 hover:underline">Inicia sesión</a>
        </p>
      </div>
    </main>
  );
}
