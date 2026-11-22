// Recupera o acesso quando alguém esquece a senha e não há outro administrador para redefinir.
// Uso (no servidor):  node scripts/redefinir-senha.js email@da.pessoa.com NovaSenhaForte123
// A pessoa será obrigada a trocar a senha no próximo acesso.
import { db } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const [email, senha] = process.argv.slice(2);
if (!email || !senha || senha.length < 8) {
  console.error('Uso: node scripts/redefinir-senha.js email@exemplo.com NovaSenha (mínimo 8 caracteres)');
  process.exit(1);
}
const u = db.get('SELECT id, nome, ativo FROM usuarios WHERE email = ?', email.toLowerCase());
if (!u) {
  console.error(`Nenhum usuário com o e-mail ${email}. Usuários existentes:`);
  for (const x of db.all('SELECT email, papel, ativo FROM usuarios ORDER BY papel, email')) console.error(` - ${x.email} (${x.papel}${x.ativo ? '' : ', desativado'})`);
  process.exit(1);
}
db.run('UPDATE usuarios SET senha_hash = ?, trocar_senha = 1, ativo = 1 WHERE id = ?', await hashPassword(senha), u.id);
db.run('DELETE FROM sessoes WHERE usuario_id = ?', u.id);
db.run("INSERT INTO auditoria (usuario_nome, acao, entidade, entidade_id, detalhes) VALUES ('Servidor', 'Senha redefinida pelo servidor', 'usuario', ?, ?)", u.id, email);
console.log(`Pronto! A senha de ${u.nome} foi redefinida. Ele(a) terá de criar uma nova ao entrar.`);
