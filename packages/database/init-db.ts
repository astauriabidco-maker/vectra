import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🧹 Nettoyage de la base de données...');
    await prisma.message.deleteMany({});
    await prisma.conversation.deleteMany({});
    await prisma.contactIdentity.deleteMany({});
    await prisma.contact.deleteMany({});
    await prisma.ticket.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.integration.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.tenantOrg.deleteMany({});

    console.log('🏢 Création du Siège (TenantOrg)...');
    const org = await prisma.tenantOrg.create({
        data: {
            name: 'Vectra Siège',
            clerkOrgId: 'org_default_test',
            plan: 'ENTERPRISE',
        },
    });

    console.log('🗼 Création de l\'Agence Paris (Workspace)...');
    const workspace = await prisma.workspace.create({
        data: {
            name: 'Agence Paris',
            twilioPhoneNumber: '+14155238886',
            tenantOrgId: org.id,
        },
    });

    console.log('✅ Succès ! La base est prête pour le test.');
    console.log(`   - TenantOrg ID: ${org.id}`);
    console.log(`   - Workspace ID: ${workspace.id}`);
    console.log(`   - Twilio Number: ${workspace.twilioPhoneNumber}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
