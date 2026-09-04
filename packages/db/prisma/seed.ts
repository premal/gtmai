import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
const db = new PrismaClient();
const people = [
  ['Ada','Lovelace','analytical.engine','Analytical Engines'],['Grace','Hopper','navy.mil','US Navy'],['Alan','Turing','turing.ai','Turing AI'],['Katherine','Johnson','nasa.gov','NASA'],['Margaret','Hamilton','apollo.dev','Apollo Software'],['Tim','Berners-Lee','web.org','Web Foundation'],['Radia','Perlman','networking.io','Networking Labs'],['Linus','Torvalds','linux.dev','Linux Foundation'],['James','Gosling','java.dev','Java Systems'],['Barbara','Liskov','distributed.systems','Distributed Systems'],['Edsger','Dijkstra','algorithms.org','Algorithms Org'],['Donald','Knuth','stanford.edu','Stanford'],['Frances','Allen','compiler.ai','Compiler AI'],['Anita','Borg','women.tech','Women Tech'],['John','McCarthy','lisp.ai','Lisp AI'],['Yoshua','Bengio','montreal.ai','Montreal AI'],['Fei-Fei','Li','vision.ai','Vision AI'],['Demis','Hassabis','deepmind.com','DeepMind'],['Aparna','Chennapragada','product.dev','Product Dev'],['Melanie','Perkins','design.tools','Design Tools'],
];
async function main(): Promise<void> {
  const passwordHash = createHash('sha256').update('demo1234').digest('hex');
  const user = await db.user.upsert({ where:{email:'demo@gtmai.dev'}, update:{}, create:{email:'demo@gtmai.dev',name:'Demo User',passwordHash} });
  const workspace = await db.workspace.create({ data:{name:'Demo Workspace',users:{create:{userId:user.id,role:'owner'}}} });
  await db.connection.create({data:{workspaceId:workspace.id,createdById:user.id,provider:'mock',name:'Mock Provider',encryptedCredentials:'{}'}});
  const table = await db.table.create({data:{workspaceId:workspace.id,name:'Prospects'}});
  const names = [
    {name:'First name',type:'text',kind:'input',position:0},{name:'Last name',type:'text',kind:'input',position:1},{name:'Domain',type:'url',kind:'input',position:2},
    {name:'Work email',type:'email',kind:'waterfall',config:{providers:[{provider:'mock',action:'mock.findEmail'}],accept:'email'},position:3},
    {name:'AI summary',type:'text',kind:'agent',config:{prompt:'Summarize {{First name}} {{Last name}} at {{Domain}}',outputFields:{summary:'string'}},position:4},
    {name:'Display name',type:'text',kind:'formula',config:{expression:'concat({{First name}}, " ", {{Last name}})'},position:5},
  ] as const;
  for (const col of names) await db.column.create({data:{tableId:table.id,config:{},...col}});
  const cols = await db.column.findMany({where:{tableId:table.id},orderBy:{position:'asc'}});
  for (let i=0;i<people.length;i++) {
    const first = people[i]![0] ?? '';
    const last = people[i]![1] ?? '';
    const domain = people[i]![2] ?? '';
    const row = await db.row.create({data:{tableId:table.id,position:i}});
    for (const col of cols) {
      const value: string | null = col.name==='First name'?first:col.name==='Last name'?last:col.name==='Domain'?domain:null;
      const data = value === null
        ? {rowId:row.id,columnId:col.id,status:'queued' as const}
        : {rowId:row.id,columnId:col.id,value,status:'done' as const};
      await db.cell.create({data});
    }
  }
}
main().finally(() => db.$disconnect());
