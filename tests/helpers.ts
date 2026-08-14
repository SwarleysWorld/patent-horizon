import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "IngestionRecord", "IngestionRun", "Patent", "Exclusivity", "Drug", "Company", "DataSource" RESTART IDENTITY CASCADE`,
  );
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "session", "account", "user", "verification" RESTART IDENTITY CASCADE`);
}

export interface TestUser {
  userId: string;
  /** Value for a request's `Cookie` header — authenticates as this user. */
  cookie: string;
}

// Creates a real user through Better Auth's own signup flow (not a
// hand-inserted DB row) so the resulting session cookie is genuinely
// valid — exercising the real auth mechanism end to end rather than
// fabricating internal session state that could drift from what Better
// Auth actually expects. Tests set the role directly afterward rather
// than relying on ANALYST_EMAILS (kept empty in .env.test) so test users
// don't depend on that env var.
let userCounter = 0;
export async function createTestUser(opts: { tier?: "subscriber" | "analyst" } = {}): Promise<TestUser> {
  userCounter += 1;
  const email = `test-user-${userCounter}@example.com`;

  const res = await auth.api.signUpEmail({
    body: { email, password: "TestPassword123!", name: `Test User ${userCounter}` },
    asResponse: true,
  });
  if (!res.ok) {
    throw new Error(`signUpEmail failed with status ${res.status}: ${await res.text()}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("signUpEmail response had no Set-Cookie header");
  const cookie = setCookie.split(";")[0];

  const body = (await res.json()) as { user: { id: string } };
  const userId = body.user.id;

  if (opts.tier === "analyst") {
    await prisma.user.update({ where: { id: userId }, data: { role: "admin" } });
  }

  return { userId, cookie };
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

export interface Fixtures {
  companyId: string;
  alphaDrugId: string; // patent expiring soon (+10d)
  betaMedId: string; // patent +100d, exclusivity +200d — exclusivity controls; drugClass "Statin"
  gammaCureId: string; // patent +1000d — far out; modality PEPTIDE
  deltaFormId: string; // patent already expired (-30d)
  epsilonGenId: string; // no patents, no exclusivities at all
  zetaOldId: string; // only a delisted patent — behaves like no barrier
  alphaDrugPatentId: string;
  betaMedExclusivityId: string;
}

// A small, deterministic dataset covering the behaviors the API needs to
// get right: which drugs count as "having a known barrier" at all, which
// of a patent/exclusivity pair controls the estimate, how delisted patents
// and already-past dates are handled, and search matching. Dates are
// relative to whenever the test runs (not hardcoded), so the suite stays
// valid indefinitely.
export async function seedFixtures(): Promise<Fixtures> {
  const company = await prisma.company.create({ data: { name: "Acme Pharma" } });

  const alphaDrug = await prisma.drug.create({
    data: {
      companyId: company.id,
      brandName: "AlphaDrug",
      genericName: "alphaine",
      applicationType: "NDA",
      applicationNumber: "NDA111111",
      productNumber: "001",
      dosageForm: "TABLET",
      route: "ORAL",
      strength: "10MG",
    },
  });
  const alphaDrugPatent = await prisma.patent.create({
    data: {
      drugId: alphaDrug.id,
      patentNumber: "9000001",
      coversDrugSubstance: true,
      nominalExpiryDate: daysFromNow(10),
      effectiveExpiryDate: daysFromNow(10),
    },
  });

  const betaMed = await prisma.drug.create({
    data: {
      companyId: company.id,
      brandName: "BetaMed",
      genericName: "betaine citrate",
      applicationType: "NDA",
      applicationNumber: "NDA222222",
      productNumber: "001",
      dosageForm: "CAPSULE",
      route: "ORAL",
      strength: "20MG",
      drugClass: "Statin",
    },
  });
  await prisma.patent.create({
    data: {
      drugId: betaMed.id,
      patentNumber: "9000002",
      coversDrugProduct: true,
      nominalExpiryDate: daysFromNow(100),
      effectiveExpiryDate: daysFromNow(100),
    },
  });
  const betaMedExclusivity = await prisma.exclusivity.create({
    data: { drugId: betaMed.id, code: "NCE", expirationDate: daysFromNow(200) },
  });

  const gammaCure = await prisma.drug.create({
    data: {
      companyId: company.id,
      brandName: "GammaCure",
      genericName: "gammazole",
      applicationType: "ANDA",
      applicationNumber: "ANDA333333",
      productNumber: "001",
      dosageForm: "INJECTABLE",
      route: "INTRAVENOUS",
      strength: "5MG/ML",
      modality: "PEPTIDE",
    },
  });
  await prisma.patent.create({
    data: {
      drugId: gammaCure.id,
      patentNumber: "9000003",
      coversDrugSubstance: true,
      nominalExpiryDate: daysFromNow(1000),
      effectiveExpiryDate: daysFromNow(1000),
    },
  });

  const deltaForm = await prisma.drug.create({
    data: {
      companyId: company.id,
      brandName: "DeltaForm",
      genericName: "deltamide",
      applicationType: "NDA",
      applicationNumber: "NDA444444",
      productNumber: "001",
      dosageForm: "TABLET",
      route: "ORAL",
      strength: "50MG",
    },
  });
  await prisma.patent.create({
    data: {
      drugId: deltaForm.id,
      patentNumber: "9000004",
      coversDrugSubstance: true,
      nominalExpiryDate: daysFromNow(-30),
      effectiveExpiryDate: daysFromNow(-30),
    },
  });

  const epsilonGen = await prisma.drug.create({
    data: {
      companyId: company.id,
      brandName: "EpsilonGen",
      genericName: "epsilonamine",
      applicationType: "ANDA",
      applicationNumber: "ANDA555555",
      productNumber: "001",
      dosageForm: "TABLET",
      route: "ORAL",
      strength: "100MG",
    },
  });
  // Deliberately no patents, no exclusivities.

  const zetaOld = await prisma.drug.create({
    data: {
      companyId: company.id,
      brandName: "ZetaOld",
      genericName: "zetazole",
      applicationType: "NDA",
      applicationNumber: "NDA666666",
      productNumber: "001",
      dosageForm: "TABLET",
      route: "ORAL",
      strength: "5MG",
    },
  });
  await prisma.patent.create({
    data: {
      drugId: zetaOld.id,
      patentNumber: "9000005",
      coversDrugSubstance: true,
      nominalExpiryDate: daysFromNow(500),
      effectiveExpiryDate: daysFromNow(500),
      delistedAt: new Date(),
    },
  });

  return {
    companyId: company.id,
    alphaDrugId: alphaDrug.id,
    betaMedId: betaMed.id,
    gammaCureId: gammaCure.id,
    deltaFormId: deltaForm.id,
    epsilonGenId: epsilonGen.id,
    zetaOldId: zetaOld.id,
    alphaDrugPatentId: alphaDrugPatent.id,
    betaMedExclusivityId: betaMedExclusivity.id,
  };
}
