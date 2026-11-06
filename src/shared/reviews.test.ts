// Reseñas de Google: lo que se copia del panel se muestra como opinión real del
// local, así que la validación (autor, puntaje, fecha) y el promedio importan.
import { describe, expect, it } from "vitest";
import {
  MAX_REVIEW_BODY,
  cleanReviewBody,
  displayRating,
  formatReviewRating,
  parseReviewDate,
  reviewDateLabel,
  reviewDistribution,
  validateReviewInput,
  type GoogleReview,
} from "./reviews";

function review(over: Partial<GoogleReview> = {}): GoogleReview {
  return {
    id: "r1",
    author: "Lucía G.",
    authorMeta: "",
    rating: 5,
    body: "Excelente",
    reviewedAt: null,
    localReply: "",
    featured: false,
    active: true,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("validación de la reseña", () => {
  it("exige un nombre con sentido", () => {
    expect(validateReviewInput({ rating: 5, author: "" }).ok).toBe(false);
    expect(validateReviewInput({ rating: 5, author: " A " }).ok).toBe(false);
    const ok = validateReviewInput({ rating: 5, author: "  Ana  " });
    expect(ok.ok && ok.value.author).toBe("Ana");
  });

  it("acepta sólo puntajes enteros de 1 a 5", () => {
    for (const bad of [0, 6, 2.5, "cinco", null, undefined]) {
      expect(validateReviewInput({ author: "Ana", rating: bad }).ok).toBe(false);
    }
    for (const good of [1, 2, 3, 4, 5]) {
      expect(validateReviewInput({ author: "Ana", rating: good }).ok).toBe(true);
    }
  });

  it("normaliza el texto y lo recorta al máximo", () => {
    const ok = validateReviewInput({ author: "Ana", rating: 5, body: "  Muy\r\nbuena   atención \n\n\n" });
    expect(ok.ok && ok.value.body).toBe("Muy\nbuena atención");
    const long = validateReviewInput({ author: "Ana", rating: 5, body: "x".repeat(MAX_REVIEW_BODY + 50) });
    expect(long.ok && long.value.body.length).toBe(MAX_REVIEW_BODY);
  });

  it("rechaza una fecha inválida o futura", () => {
    expect(validateReviewInput({ author: "Ana", rating: 5, reviewedAt: "no-es-fecha" }).ok).toBe(false);
    const future = Date.now() + 10 * 86_400_000;
    expect(validateReviewInput({ author: "Ana", rating: 5, reviewedAt: future }).ok).toBe(false);
    expect(validateReviewInput({ author: "Ana", rating: 5, reviewedAt: "2026-10-12" }).ok).toBe(true);
  });

  it("por defecto queda visible y no destacada", () => {
    const ok = validateReviewInput({ author: "Ana", rating: 4 });
    expect(ok.ok && ok.value.active).toBe(true);
    expect(ok.ok && ok.value.featured).toBe(false);
  });

  it("el orden manual se limita a ±999", () => {
    const ok = validateReviewInput({ author: "Ana", rating: 4, sortOrder: 50_000 });
    expect(ok.ok && ok.value.sortOrder).toBe(999);
  });
});

describe("promedio y presentación", () => {
  it("el promedio cargado a mano manda sobre las reseñas cargadas", () => {
    const list = [review({ rating: 1 }), review({ rating: 1 })];
    expect(displayRating(4.9, list)).toBe(4.9);
    expect(displayRating(0, list)).toBe(1);
    expect(displayRating(0, [])).toBe(0);
  });

  it("no cuenta las reseñas ocultas en el promedio calculado", () => {
    const list = [review({ rating: 5 }), review({ rating: 1, active: false })];
    expect(displayRating(0, list)).toBe(5);
  });

  it("escribe el promedio con coma y sin decimales de más", () => {
    expect(formatReviewRating(4.9)).toBe("4,9");
    expect(formatReviewRating(4.94)).toBe("4,9");
    expect(formatReviewRating(5)).toBe("5");
    expect(formatReviewRating(0)).toBe("");
  });

  it("cuenta la distribución sólo de las visibles", () => {
    const dist = reviewDistribution([
      review({ rating: 5 }),
      review({ rating: 5 }),
      review({ rating: 4 }),
      review({ rating: 1, active: false }),
    ]);
    expect(dist).toEqual({ 1: 0, 2: 0, 3: 0, 4: 1, 5: 2 });
  });
});

describe("fechas", () => {
  it("parsea AAAA-MM-DD al mediodía argentino", () => {
    const ms = parseReviewDate("2026-10-12");
    expect(ms).not.toBeNull();
    expect(new Date(ms!).toISOString()).toBe("2026-10-12T15:00:00.000Z");
    expect(parseReviewDate("")).toBeNull();
    expect(parseReviewDate(null)).toBeNull();
  });

  it("etiqueta la antigüedad como se lee en el sitio", () => {
    const now = Date.parse("2026-11-06T12:00:00Z");
    expect(reviewDateLabel(now, now)).toBe("hoy");
    expect(reviewDateLabel(now - 86_400_000, now)).toBe("ayer");
    expect(reviewDateLabel(now - 3 * 86_400_000, now)).toBe("hace 3 días");
    expect(reviewDateLabel(now - 14 * 86_400_000, now)).toBe("hace 2 semanas");
    expect(reviewDateLabel(now - 90 * 86_400_000, now)).toBe("hace 3 meses");
    expect(reviewDateLabel(null, now)).toBe("");
  });

  it("cuenta días de calendario argentinos, no bloques de 24 horas", () => {
    // Ayer a la tarde (15:00 en Santa Fe) y hoy a la mañana: son 17 horas hábiles
    // de diferencia, pero para quien lee fue "ayer".
    const manana = Date.parse("2026-11-06T11:00:00Z");
    expect(reviewDateLabel(Date.parse("2026-11-05T18:00:00Z"), manana)).toBe("ayer");
    // Mismo día aunque falten pocas horas para la medianoche.
    const noche = Date.parse("2026-11-07T02:00:00Z");
    expect(reviewDateLabel(Date.parse("2026-11-06T15:00:00Z"), noche)).toBe("hoy");
  });

  it("limpia los saltos de línea repetidos del cuerpo", () => {
    expect(cleanReviewBody("a\n\n\n\nb")).toBe("a\n\nb");
  });
});
