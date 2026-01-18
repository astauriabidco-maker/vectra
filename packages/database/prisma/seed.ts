import { PrismaClient, IdentityType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Starting seeding for Vectra V2 (Multi-Tenancy)...');

    // 0. Cleanup
    console.log('🧹 Cleaning up database...');
    await prisma.message.deleteMany({});
    await prisma.conversation.deleteMany({});
    await prisma.contactIdentity.deleteMany({});
    await prisma.contact.deleteMany({});
    await prisma.ticket.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.integration.deleteMany({});
    await prisma.workspace.deleteMany({});
    await prisma.tenantOrg.deleteMany({});

    // 1. Create TenantOrg (HQ)
    const tenantOrg = await prisma.tenantOrg.create({
        data: {
            clerkOrgId: 'org_default_test',
            name: 'Vectra Siège',
            plan: 'ENTERPRISE',
        },
    });
    console.log(`✅ Created TenantOrg: ${tenantOrg.name} (Clerk: ${tenantOrg.clerkOrgId})`);

    // 2. Create Workspace (Paris)
    const workspaceParis = await prisma.workspace.create({
        data: {
            tenantOrgId: tenantOrg.id,
            name: 'Agence Paris',
            twilioPhoneNumber: '+14155238886', // Sandbox number (WITHOUT prefix for controller lookup)
        },
    });
    console.log(`✅ Created Workspace: ${workspaceParis.name} (Twilio: ${workspaceParis.twilioPhoneNumber})`);

    // 3. Create Contact in Paris workspace (optional but good for test)
    const contactAlice = await prisma.contact.create({
        data: {
            workspaceId: workspaceParis.id,
            attributes: {
                name: 'Alice Demo',
                email: 'alice@example.com',
            },
            identities: {
                create: [
                    {
                        type: IdentityType.WHATSAPP,
                        identifier: 'whatsapp:+33612345678',
                        isPrimary: true,
                    },
                ],
            },
        },
    });
    console.log(`✅ Created Contact: Alice Demo (Paris)`);

    console.log('🏁 Seeding finished for Vectra V2!');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
